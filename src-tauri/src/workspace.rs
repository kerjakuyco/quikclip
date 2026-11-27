//! The workspace (projects, the open project, export history) as a file in the app's data folder, instead of the
//! webview's storage, which holds only a few megabytes. Written to a temporary file and moved into place, so a crash
//! mid-write never leaves half a workspace; the one before is kept as a backup.
use crate::media::Result;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::fs;

/// The largest workspace written, far above any real one: a safeguard, not a quota.
const MAX_BYTES: usize = 256 * 1024 * 1024;

fn folder(app: &AppHandle) -> Result<PathBuf> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}

/// The saved workspace as JSON, the backup if the file itself can't be read, or None before the first save.
pub async fn read_from(dir: &Path) -> Result<Option<String>> {
    for name in ["workspace.json", "workspace.backup.json"] {
        if let Ok(text) = fs::read_to_string(dir.join(name)).await {
            if serde_json::from_str::<serde_json::Value>(&text).is_ok() {
                return Ok(Some(text));
            }
        }
    }
    Ok(None)
}

/// Saves the workspace: the new JSON goes to a temporary file, the current one becomes the backup, and the new one
/// takes its place.
pub async fn write_to(dir: &Path, contents: &str) -> Result<()> {
    if contents.len() > MAX_BYTES {
        return Err("The workspace is too large to save.".into());
    }
    serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|_| "The workspace could not be saved: it isn't valid JSON.".to_string())?;
    fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
    let (file, temp, backup) = (
        dir.join("workspace.json"),
        dir.join("workspace.json.tmp"),
        dir.join("workspace.backup.json"),
    );
    fs::write(&temp, contents)
        .await
        .map_err(|e| format!("The workspace could not be saved: {e}"))?;
    if fs::try_exists(&file).await.unwrap_or(false) {
        let _ = fs::remove_file(&backup).await;
        fs::rename(&file, &backup)
            .await
            .map_err(|e| format!("The workspace could not be saved: {e}"))?;
    }
    fs::rename(&temp, &file)
        .await
        .map_err(|e| format!("The workspace could not be saved: {e}"))
}

#[tauri::command]
pub async fn read_workspace(app: AppHandle) -> Result<Option<String>> {
    read_from(&folder(&app)?).await
}

#[tauri::command]
pub async fn write_workspace(app: AppHandle, contents: String) -> Result<()> {
    write_to(&folder(&app)?, &contents).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn the_workspace_is_saved_whole_and_the_last_one_kept() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_from(dir.path()).await.unwrap(), None);
        write_to(dir.path(), r#"{"projects":[1]}"#).await.unwrap();
        write_to(dir.path(), r#"{"projects":[1,2]}"#).await.unwrap();
        assert_eq!(
            read_from(dir.path()).await.unwrap().as_deref(),
            Some(r#"{"projects":[1,2]}"#)
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("workspace.backup.json"))
                .await
                .unwrap(),
            r#"{"projects":[1]}"#
        );
        // Not JSON: refused, and nothing changes.
        assert!(write_to(dir.path(), "{broken").await.is_err());
        assert_eq!(
            read_from(dir.path()).await.unwrap().as_deref(),
            Some(r#"{"projects":[1,2]}"#)
        );
        // A damaged file falls back to the backup.
        fs::write(dir.path().join("workspace.json"), "{half")
            .await
            .unwrap();
        assert_eq!(
            read_from(dir.path()).await.unwrap().as_deref(),
            Some(r#"{"projects":[1]}"#)
        );
    }
}
