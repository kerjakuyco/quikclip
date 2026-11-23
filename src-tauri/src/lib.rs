mod ai;
mod jobs;
mod media;

pub fn run() {
    tauri::Builder::default()
        .manage(jobs::Jobs::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            jobs::import_local,
            jobs::import_youtube,
            jobs::export_clip,
            jobs::find_highlights,
            jobs::cancel_job
        ])
        .run(tauri::generate_context!())
        .expect("could not open Quikclip Studio");
}
