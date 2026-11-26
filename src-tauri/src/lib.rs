mod ai;
mod captions;
mod highlights;
mod jobs;
mod media;
mod progress;
mod providers;
mod transcript;
mod translate;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // Keep each platform's native controls except on Windows, where Studio draws them.
                #[cfg(target_os = "windows")]
                if let Err(error) = window.set_decorations(false) {
                    eprintln!("Could not customize the title bar: {error}");
                }
                window.show()?;
            }
            Ok(())
        })
        .manage(jobs::Jobs::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            jobs::import_local,
            jobs::import_youtube,
            jobs::export_clip,
            jobs::find_pauses,
            jobs::delete_media,
            jobs::draw_wave,
            jobs::transcribe_source,
            jobs::read_transcript,
            jobs::save_text,
            jobs::translate_captions,
            jobs::pick_music,
            jobs::forget_music,
            jobs::pick_logo,
            jobs::forget_logo,
            jobs::find_highlights,
            jobs::cancel_job,
            providers::connect_ai,
            providers::forget_ai
        ])
        .run(tauri::generate_context!())
        .expect("could not open Quikclip Studio");
}
