use crate::{ai, media, media::Result};
use std::{future::Future, sync::Mutex};
use tauri::{AppHandle, State};
use tokio::sync::watch;

#[derive(Default)]
pub struct Jobs(Mutex<Option<watch::Sender<bool>>>);

impl Jobs {
    async fn process<T>(&self, future: impl Future<Output = Result<T>>) -> Result<T> {
        let (send, mut cancel) = watch::channel(false);
        {
            let mut active = self.0.lock().map_err(|_| "Job state unavailable.")?;
            if active.is_some() {
                return Err("Wait for the active job to finish.".into());
            }
            *active = Some(send);
        }
        let result = tokio::select! {
            biased;
            _ = cancel.changed() => Err("Operation cancelled.".into()),
            value = future => value,
        };
        *self.0.lock().map_err(|_| "Job state unavailable.")? = None;
        result
    }
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
) -> Result<Vec<ai::Suggestion>> {
    jobs.process(ai::find_highlights(app, id, connection, model))
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
    headline: String,
    voice: bool,
    music: String,
    volume: f64,
    pauses: bool,
    logo: String,
    corner: String,
    speed: f64,
    captions: Option<String>,
) -> Result<Option<String>> {
    jobs.process(media::export_clip(
        app,
        id,
        title,
        start,
        end,
        shape,
        fit,
        headline,
        voice,
        music,
        volume,
        pauses,
        logo,
        corner,
        speed,
        captions.unwrap_or_default(),
    ))
    .await
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
) -> Result<crate::transcript::Transcript> {
    crate::transcript::transcribe_source(app, id, connection).await
}

#[tauri::command]
pub async fn read_transcript(
    app: AppHandle,
    id: String,
) -> Result<Option<crate::transcript::Transcript>> {
    crate::transcript::read_transcript(app, id).await
}
