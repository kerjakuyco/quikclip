mod ai;
mod jobs;
mod media;
mod providers;

pub fn run() {
    tauri::Builder::default()
        .manage(jobs::Jobs::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            jobs::import_local,
            jobs::import_youtube,
            jobs::export_clip,
            jobs::find_highlights,
            jobs::cancel_job,
            providers::connect_ai,
            providers::forget_ai
        ])
        .run(tauri::generate_context!())
        .expect("could not open Quikclip Studio");
}
