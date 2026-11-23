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
pub async fn import_local(app: AppHandle, jobs: State<'_, Jobs>) -> Result<Option<media::Media>> {
    jobs.process(media::import_local(app)).await
}

#[tauri::command]
pub async fn import_youtube(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    url: String,
) -> Result<media::Media> {
    jobs.process(media::import_youtube(app, url)).await
}

#[tauri::command]
pub async fn find_highlights(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    id: String,
) -> Result<Vec<ai::Suggestion>> {
    jobs.process(ai::find_highlights(app, id)).await
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
) -> Result<Option<String>> {
    jobs.process(media::export_clip(app, id, title, start, end, shape))
        .await
}
