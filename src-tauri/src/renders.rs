//! The render queue's side (src/renders.ts): renders run as jobs of their own, beside an import or a transcript, each
//! with its own cancel and its progress as `render-progress` events. The studio runs one at a time, in order; the
//! destination is chosen when a render is queued, so nothing asks for it later.
use crate::media::{self, BatchReport, ExportRequest, Result};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::watch;

#[derive(Default)]
pub struct Renders(Mutex<HashMap<String, watch::Sender<bool>>>);

/// A render's place in the registry, given back when it ends however it ends.
struct Running<'a> {
    renders: &'a Renders,
    job: String,
}

impl Drop for Running<'_> {
    fn drop(&mut self) {
        if let Ok(mut map) = self.renders.0.lock() {
            map.remove(&self.job);
        }
    }
}

impl Renders {
    fn start(&self, job: &str) -> Result<(Running<'_>, watch::Receiver<bool>)> {
        if job.is_empty() || job.len() > 100 {
            return Err("Unknown render.".into());
        }
        let (send, cancel) = watch::channel(false);
        let mut map = self.0.lock().map_err(|_| "Render state unavailable.")?;
        if map.contains_key(job) {
            return Err("That render is already running.".into());
        }
        map.insert(job.to_string(), send);
        Ok((
            Running {
                renders: self,
                job: job.to_string(),
            },
            cancel,
        ))
    }
}

#[derive(Clone, Serialize)]
struct Progress {
    job: String,
    fraction: f64,
}

/// Reports a render's progress, a few times a second at most and only forwards.
fn reporter(app: &AppHandle, job: &str) -> Arc<dyn Fn(f64) + Send + Sync> {
    let app = app.clone();
    let job = job.to_string();
    let last = Mutex::new((0.0_f64, Instant::now() - Duration::from_secs(1)));
    Arc::new(move |fraction| {
        let Ok(mut last) = last.lock() else { return };
        let fraction = fraction.clamp(0.0, 1.0);
        if fraction < last.0 || (last.1.elapsed() < Duration::from_millis(200) && fraction < 1.0) {
            return;
        }
        *last = (fraction, Instant::now());
        let _ = app.emit(
            "render-progress",
            Progress {
                job: job.clone(),
                fraction,
            },
        );
    })
}

/// Runs a render as job `job`: cancelled by `cancel_render`, reporting progress while it encodes.
async fn run<T, F>(
    app: &AppHandle,
    renders: &Renders,
    job: &str,
    work: impl FnOnce(watch::Receiver<bool>) -> F,
) -> Result<T>
where
    F: std::future::Future<Output = Result<T>>,
{
    let (_running, mut cancel) = renders.start(job)?;
    let task = media::RENDER_PROGRESS.scope(reporter(app, job), work(cancel.clone()));
    tokio::select! {
        biased;
        _ = cancel.changed() => Err("Render cancelled.".into()),
        result = task => result,
    }
}

/// Where to save one video: the system's save dialog, suggesting `name`.
#[tauri::command]
pub async fn pick_export_file(app: AppHandle, name: String) -> Result<Option<String>> {
    let dialog = app
        .dialog()
        .file()
        .add_filter("MPEG-4 video", &["mp4"])
        .set_file_name(format!("{}.mp4", media::file_stem(&name)));
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    picked
        .map(|path| {
            path.into_path()
                .map_err(|e| e.to_string())
                .and_then(|path| media::text(&path).map(str::to_string))
        })
        .transpose()
}

/// Where a batch goes: the system's folder dialog. The batch makes a new folder inside it.
#[tauri::command]
pub async fn pick_export_folder(app: AppHandle) -> Result<Option<String>> {
    let dialog = app
        .dialog()
        .file()
        .set_title("Choose a folder for the export batch");
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|e| e.to_string())?;
    picked
        .map(|path| {
            path.into_path()
                .map_err(|e| e.to_string())
                .and_then(|path| media::text(&path).map(str::to_string))
        })
        .transpose()
}

#[tauri::command]
pub async fn render_clip(
    app: AppHandle,
    renders: State<'_, Renders>,
    job: String,
    id: String,
    request: ExportRequest,
    target: String,
) -> Result<String> {
    let target = PathBuf::from(target);
    run(&app, &renders, &job, |_| {
        media::render_clip_to(&app, &id, request, &target)
    })
    .await
}

#[tauri::command]
pub async fn render_batch(
    app: AppHandle,
    renders: State<'_, Renders>,
    job: String,
    id: String,
    requests: Vec<ExportRequest>,
    folder: String,
) -> Result<BatchReport> {
    run(&app, &renders, &job, |cancel| {
        media::render_batch_into(&app, &id, requests, PathBuf::from(folder), cancel)
    })
    .await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn render_joined(
    app: AppHandle,
    renders: State<'_, Renders>,
    job: String,
    id: String,
    requests: Vec<ExportRequest>,
    transition: String,
    intro: Option<String>,
    outro: Option<String>,
    target: String,
) -> Result<String> {
    let target = PathBuf::from(target);
    run(&app, &renders, &job, |cancel| {
        crate::join::render_joined_to(
            &app,
            &id,
            requests,
            &transition,
            intro,
            outro,
            &target,
            cancel,
        )
    })
    .await
}

/// Stops a queued render that is running. One that isn't running has nothing to stop.
#[tauri::command]
pub fn cancel_render(renders: State<'_, Renders>, job: String) -> Result<()> {
    if let Some(send) = renders
        .0
        .lock()
        .map_err(|_| "Render state unavailable.")?
        .get(&job)
    {
        let _ = send.send(true);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_render_has_its_own_place_and_cancel() {
        let renders = Renders::default();
        let (one, cancel) = renders.start("a").unwrap();
        assert!(renders.start("a").is_err());
        let (_two, other) = renders.start("b").unwrap();
        renders
            .0
            .lock()
            .unwrap()
            .get("a")
            .unwrap()
            .send(true)
            .unwrap();
        assert!(*cancel.borrow());
        assert!(!*other.borrow());
        drop(one);
        assert!(renders.start("a").is_ok());
        assert!(renders.start("").is_err());
    }
}
