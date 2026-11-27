use crate::{ai, join, media, media::Result};
use std::{future::Future, sync::Mutex};
use tauri::{AppHandle, State};
use tokio::sync::watch;

#[derive(Default)]
pub struct Jobs(Mutex<Option<watch::Sender<bool>>>);

struct Running<'a>(&'a Jobs);

impl Drop for Running<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.0 .0.lock() {
            *active = None;
        }
    }
}

impl Jobs {
    fn start(&self) -> Result<(Running<'_>, watch::Receiver<bool>)> {
        let (send, cancel) = watch::channel(false);
        let mut active = self.0.lock().map_err(|_| "Job state unavailable.")?;
        if active.is_some() {
            return Err("Wait for the active job to finish.".into());
        }
        *active = Some(send);
        Ok((Running(self), cancel))
    }

    async fn process<T>(&self, future: impl Future<Output = Result<T>>) -> Result<T> {
        let (_running, mut cancel) = self.start()?;
        tokio::select! {
            biased;
            _ = cancel.changed() => Err("Operation cancelled.".into()),
            value = future => value,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cancellable_batch_holds_the_job_slot_until_it_reports() {
        let jobs = Jobs::default();
        let (running, cancel) = jobs.start().unwrap();
        assert!(jobs.start().is_err());
        jobs.0.lock().unwrap().as_ref().unwrap().send(true).unwrap();
        assert!(*cancel.borrow());
        assert!(jobs.start().is_err());
        drop(running);
        assert!(jobs.start().is_ok());
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
    let (_running, cancel) = jobs.start()?;
    join::export_joined(app, id, requests, transition, intro, outro, cancel).await
}

#[tauri::command]
pub async fn pick_bookend(app: AppHandle) -> Result<Option<join::BookendFile>> {
    join::pick_bookend(app).await
}

#[tauri::command]
pub fn cancel_job(jobs: State<'_, Jobs>) -> Result<()> {
    if let Some(job) = jobs
        .0
        .lock()
        .map_err(|_| "Job state unavailable.")?
        .as_ref()
    {
        let _ = job.send(true);
    }
    Ok(())
}

#[tauri::command]
pub async fn import_local(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    playable: Option<media::Playable>,
) -> Result<Option<media::Media>> {
    jobs.process(media::import_local(app, playable.unwrap_or_default()))
        .await
}

#[tauri::command]
pub async fn import_youtube(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    url: String,
    playable: Option<media::Playable>,
) -> Result<media::Media> {
    jobs.process(media::import_youtube(
        app,
        url,
        playable.unwrap_or_default(),
    ))
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
    jobs.process(ai::find_highlights(
        app,
        id,
        connection,
        model,
        options.unwrap_or_default(),
    ))
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
) -> Result<Option<String>> {
    jobs.process(media::export_clip(
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
        },
    ))
    .await
}

#[tauri::command]
pub async fn export_batch(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    id: String,
    requests: Vec<media::ExportRequest>,
) -> Result<Option<media::BatchReport>> {
    let (_running, cancel) = jobs.start()?;
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
