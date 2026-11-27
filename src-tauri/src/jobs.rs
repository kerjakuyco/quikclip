use crate::progress::Step;
use crate::{ai, join, media, media::Result};
use serde::Serialize;
use std::{future::Future, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::watch;

/// The one media job that runs at a time (an import, a highlight search, an export), what it is and how far it has
/// got, so a window that opens while it runs (or reloads) can show it and cancel it; and an import that finished after
/// its window went away, kept for the next one to take.
#[derive(Default)]
pub struct Jobs {
    active: Mutex<Option<Active>>,
    kept: Mutex<Option<serde_json::Value>>,
}

struct Active {
    cancel: watch::Sender<bool>,
    title: String,
    /// Milliseconds since the Unix epoch.
    started: u64,
    step: Option<Step>,
    /// A window that opened after the job started asked about it: the one that started it is gone.
    adopted: bool,
}

/// The running job, as a window sees it.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobInfo {
    pub title: String,
    pub started: u64,
    pub step: Option<Step>,
}

/// Sent when a job ends, so every window can stop showing it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JobDone {
    title: String,
    error: Option<String>,
    /// An import the window that started it never got: take it with `take_kept_import`.
    kept: bool,
}

struct Running<'a>(&'a Jobs);

impl Drop for Running<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.0.active.lock() {
            *active = None;
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Jobs {
    fn start(&self, title: &str) -> Result<(Running<'_>, watch::Receiver<bool>)> {
        let (send, cancel) = watch::channel(false);
        let mut active = self.active.lock().map_err(|_| "Job state unavailable.")?;
        if let Some(running) = active.as_ref() {
            return Err(format!(
                "Wait for the active job to finish: {}. Its progress is in the status bar.",
                running.title.trim_end_matches('…')
            ));
        }
        *active = Some(Active {
            cancel: send,
            title: title.to_owned(),
            started: now_ms(),
            step: None,
            adopted: false,
        });
        Ok((Running(self), cancel))
    }

    /// The job running now, marked as seen by a window that didn't start it.
    fn adopt(&self) -> Option<JobInfo> {
        let mut active = self.active.lock().ok()?;
        let running = active.as_mut()?;
        running.adopted = true;
        Some(JobInfo {
            title: running.title.clone(),
            started: running.started,
            step: running.step.clone(),
        })
    }

    fn adopted(&self) -> bool {
        self.active
            .lock()
            .ok()
            .and_then(|active| active.as_ref().map(|running| running.adopted))
            .unwrap_or(false)
    }

    /// Runs a job until it ends or is cancelled, and says so to every window. An import whose window went away is
    /// kept for the next one.
    async fn process<T: Serialize>(
        &self,
        app: &AppHandle,
        title: &str,
        keep: bool,
        future: impl Future<Output = Result<T>>,
    ) -> Result<T> {
        let (running, mut cancel) = self.start(title)?;
        let result = tokio::select! {
            biased;
            _ = cancel.changed() => Err("Operation cancelled.".into()),
            value = future => value,
        };
        let kept = keep
            && self.adopted()
            && match &result {
                Ok(value) => match (serde_json::to_value(value), self.kept.lock()) {
                    (Ok(value), Ok(mut kept)) if !value.is_null() => {
                        *kept = Some(value);
                        true
                    }
                    _ => false,
                },
                Err(_) => false,
            };
        drop(running);
        let _ = app.emit(
            "job-done",
            JobDone {
                title: title.to_owned(),
                error: result.as_ref().err().cloned(),
                kept,
            },
        );
        result
    }

    fn record(&self, step: &Step) {
        if let Ok(mut active) = self.active.lock() {
            if let Some(running) = active.as_mut() {
                running.step = Some(step.clone());
            }
        }
    }
}

/// A job's progress, shown to every window and kept for one that opens while it runs.
pub fn show_step(app: &AppHandle, step: Step) {
    if let Some(jobs) = app.try_state::<Jobs>() {
        jobs.record(&step);
    }
    let _ = app.emit("studio-step", step);
}

/// The job running now, if any. A window asks once as it opens.
#[tauri::command]
pub fn current_job(jobs: State<'_, Jobs>) -> Option<JobInfo> {
    jobs.adopt()
}

/// An import that finished while no window was waiting for it, once.
#[tauri::command]
pub fn take_kept_import(jobs: State<'_, Jobs>) -> Option<serde_json::Value> {
    jobs.kept.lock().ok().and_then(|mut kept| kept.take())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cancellable_batch_holds_the_job_slot_until_it_reports() {
        let jobs = Jobs::default();
        let (running, cancel) = jobs.start("Downloading and preparing video…").unwrap();
        let busy = jobs.start("Another").err().unwrap();
        assert!(busy.contains("Downloading and preparing video."), "{busy}");
        jobs.active
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .cancel
            .send(true)
            .unwrap();
        assert!(*cancel.borrow());
        assert!(jobs.start("Another").is_err());
        drop(running);
        assert!(jobs.start("Another").is_ok());
    }

    #[test]
    fn a_window_that_opens_during_a_job_sees_it_and_its_last_step() {
        let jobs = Jobs::default();
        assert_eq!(jobs.adopt(), None);
        let (_running, _) = jobs.start("Downloading").unwrap();
        assert!(!jobs.adopted());
        let step = Step {
            steps: vec!["Download", "Editing copy"],
            index: 0,
            label: "Downloading".into(),
            fraction: Some(0.4),
            detail: None,
            about: None,
        };
        jobs.record(&step);
        let seen = jobs.adopt().unwrap();
        assert_eq!(
            (seen.title.as_str(), seen.step),
            ("Downloading", Some(step))
        );
        assert!(jobs.adopted());
    }
}

/// Clips joined into one video, between an optional opening shot and end card.
#[tauri::command]
pub async fn export_joined(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    id: String,
    requests: Vec<media::ExportRequest>,
    transition: String,
    intro: Option<String>,
    outro: Option<String>,
) -> Result<Option<String>> {
    let (_running, cancel) = jobs.start("Joining clips…")?;
    join::export_joined(app, id, requests, transition, intro, outro, cancel).await
}

#[tauri::command]
pub async fn pick_bookend(app: AppHandle) -> Result<Option<join::BookendFile>> {
    join::pick_bookend(app).await
}

/// Whether exports may use the graphics card's encoder (the studio's export setting).
#[tauri::command]
pub fn set_gpu_exports(on: bool) {
    media::set_gpu_exports(on);
}

#[tauri::command]
pub fn cancel_job(jobs: State<'_, Jobs>) -> Result<()> {
    if let Some(job) = jobs
        .active
        .lock()
        .map_err(|_| "Job state unavailable.")?
        .as_ref()
    {
        let _ = job.cancel.send(true);
    }
    Ok(())
}

#[tauri::command]
pub async fn import_local(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    playable: Option<media::Playable>,
) -> Result<Option<media::Media>> {
    let events = app.clone();
    jobs.process(
        &events,
        "Preparing a video…",
        true,
        media::import_local(app, playable.unwrap_or_default()),
    )
    .await
}

#[tauri::command]
pub async fn import_youtube(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    url: String,
    playable: Option<media::Playable>,
) -> Result<media::Media> {
    let events = app.clone();
    jobs.process(
        &events,
        "Downloading and preparing a video…",
        true,
        media::import_youtube(app, url, playable.unwrap_or_default()),
    )
    .await
}

#[tauri::command]
pub async fn find_highlights(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    id: String,
    connection: crate::providers::Connection,
    model: String,
    options: Option<crate::highlights::SearchOptions>,
) -> Result<Vec<crate::highlights::Pick>> {
    let events = app.clone();
    jobs.process(
        &events,
        "Finding highlights…",
        false,
        ai::find_highlights(app, id, connection, model, options.unwrap_or_default()),
    )
    .await
}

/// Not a job: the waveform draws while the editor is in use, alongside other work.
#[tauri::command]
pub async fn draw_wave(app: AppHandle, id: String) -> Result<Option<std::path::PathBuf>> {
    media::draw_wave(app, id).await
}

#[tauri::command]
pub async fn delete_media(app: AppHandle, id: String) -> Result<()> {
    media::delete_media(app, id).await
}

#[tauri::command]
pub async fn pick_music(app: AppHandle) -> Result<Option<media::MusicFile>> {
    media::pick_music(app).await
}

#[tauri::command]
pub async fn forget_music(app: AppHandle, path: String) -> Result<()> {
    media::forget_music(app, path).await
}

#[tauri::command]
pub async fn pick_logo(app: AppHandle) -> Result<Option<media::LogoFile>> {
    media::pick_logo(app).await
}

#[tauri::command]
pub async fn forget_logo(app: AppHandle, path: String) -> Result<()> {
    media::forget_logo(app, path).await
}

#[tauri::command]
pub async fn find_pauses(
    app: AppHandle,
    id: String,
    start: f64,
    end: f64,
) -> Result<media::PausePlan> {
    media::find_pauses(app, id, start, end).await
}

#[tauri::command]
pub async fn export_clip(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    id: String,
    title: String,
    start: f64,
    end: f64,
    shape: String,
    fit: String,
    crop: Option<media::CropPosition>,
    headline: String,
    voice: bool,
    music: String,
    volume: Option<f64>,
    music_mix: Option<media::MusicMix>,
    pauses: bool,
    logo: String,
    corner: String,
    speed: f64,
    captions: Option<String>,
    loudness: Option<i32>,
    camera: Option<Vec<media::CropKey>>,
    drops: Option<Vec<(f64, f64)>>,
    zooms: Option<Vec<(f64, f64)>>,
    broll: Option<Vec<media::BRollRequest>>,
    texts: Option<Vec<crate::texts::TextRequest>>,
    cam: Option<media::CamBox>,
) -> Result<Option<String>> {
    let events = app.clone();
    jobs.process(
        &events,
        "Exporting a clip…",
        false,
        media::export_clip(
            app,
            id,
            media::ExportRequest {
                title,
                start,
                end,
                shape,
                fit,
                crop: crop.unwrap_or_default(),
                headline,
                voice,
                music,
                music_mix: music_mix.or_else(|| volume.map(media::MusicMix::with_volume)),
                pauses,
                logo,
                corner,
                speed,
                captions: captions.unwrap_or_default(),
                loudness,
                camera: camera.unwrap_or_default(),
                drops: drops.unwrap_or_default(),
                zooms: zooms.unwrap_or_default(),
                video: None,
                broll: broll.unwrap_or_default(),
                texts: texts.unwrap_or_default(),
                cam,
            },
        ),
    )
    .await
}

#[tauri::command]
pub async fn export_batch(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    id: String,
    requests: Vec<media::ExportRequest>,
) -> Result<Option<media::BatchReport>> {
    let (_running, cancel) = jobs.start("Rendering clips…")?;
    media::export_batch(app, id, requests, cancel).await
}

#[tauri::command]
pub async fn save_text(
    app: AppHandle,
    name: String,
    extension: String,
    contents: String,
) -> Result<Option<String>> {
    media::save_text(app, name, extension, contents).await
}

/// Not a job: a long video's transcript is made while the editor is in use, alongside other work.
#[tauri::command]
pub async fn transcribe_source(
    app: AppHandle,
    id: String,
    connection: crate::providers::Connection,
    language: Option<String>,
    again: Option<bool>,
) -> Result<crate::transcript::Transcript> {
    crate::transcript::transcribe_source(app, id, connection, language, again.unwrap_or(false))
        .await
}

/// Caption lines in another language, one per line. Not a job: it is quick and the editor stays usable.
#[tauri::command]
pub async fn translate_captions(
    connection: crate::providers::Connection,
    model: String,
    language: String,
    lines: Vec<String>,
) -> Result<Vec<String>> {
    crate::translate::translate_lines(connection, model, language, lines).await
}

#[tauri::command]
pub async fn read_transcript(
    app: AppHandle,
    id: String,
) -> Result<Option<crate::transcript::Transcript>> {
    crate::transcript::read_transcript(app, id).await
}
