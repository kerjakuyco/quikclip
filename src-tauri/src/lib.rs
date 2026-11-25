mod ai;
mod captions;
mod highlights;
mod jobs;
mod media;
mod progress;
mod providers;
mod transcript;

pub fn run() {
    tauri::Builder::default()
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
