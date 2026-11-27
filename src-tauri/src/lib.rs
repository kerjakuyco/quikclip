mod ai;
mod assistant;
mod captions;
mod faces;
mod highlights;
mod jobs;
mod join;
mod media;
mod post;
mod progress;
mod providers;
mod renders;
mod suggest;
mod texts;
mod transcript;
mod translate;
mod workspace;

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
        .manage(renders::Renders::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            jobs::import_local,
            jobs::import_youtube,
            jobs::export_clip,
            jobs::export_batch,
            jobs::export_joined,
            jobs::pick_bookend,
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
            faces::find_faces,
            post::write_post_copy,
            suggest::suggest_for_clip,
            assistant::ask_assistant,
            jobs::cancel_job,
            jobs::set_gpu_exports,
            jobs::current_job,
            jobs::take_kept_import,
            renders::pick_export_file,
            renders::pick_export_folder,
            renders::render_clip,
            renders::render_batch,
            renders::render_joined,
            renders::cancel_render,
            workspace::read_workspace,
            workspace::write_workspace,
            providers::connect_ai,
            providers::forget_ai
        ])
        .run(tauri::generate_context!())
        .expect("could not open Quikclip Studio");
}
