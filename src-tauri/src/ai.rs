use crate::media::{probe, run, source, valid_range, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize)]
pub struct Suggestion {
    title: String,
    start: f64,
    end: f64,
}

pub async fn find_highlights(app: AppHandle, id: String) -> Result<Vec<Suggestion>> {
    let model = std::env::var("QUIKCLIP_MODEL").unwrap_or_else(|_| "gemma3:4b".into());
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let tags = client
        .get("http://127.0.0.1:11434/api/tags")
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|_| "Start Ollama on this device, then try again.")?
        .json::<serde_json::Value>()
        .await
        .map_err(|_| "Ollama returned an unexpected response.")?;
    if !tags["models"]
        .as_array()
        .is_some_and(|m| m.iter().any(|m| m["name"] == model))
    {
        return Err(format!(
            "Install the local vision model with: ollama pull {model}"
        ));
    }
    let path = source(&app, &id)?;
    let (duration, ..) = probe(&path).await?;
    let work = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut times = Vec::new();
    for i in 0..9 {
        let _ = app.emit("studio-progress", format!("Sampling frame {} of 9…", i + 1));
        let time = duration * i as f64 / 9.0;
        let jpeg = run(
            "ffmpeg",
            &[
                "-v",
                "error",
                "-ss",
                &time.to_string(),
                "-i",
                path.to_str().ok_or("Invalid source path.")?,
                "-frames:v",
                "1",
                "-vf",
                "scale=384:216:force_original_aspect_ratio=decrease,pad=384:216:(ow-iw)/2:(oh-ih)/2",
                "-f",
                "image2pipe",
                "-vcodec",
                "mjpeg",
                "pipe:1",
            ],
            45,
        )
        .await?;
        if !jpeg.is_empty() {
            tokio::fs::write(work.path().join(format!("{:02}.jpg", times.len())), jpeg)
                .await
                .map_err(|e| e.to_string())?;
            times.push(format!("{time:.2}"));
        }
    }
    if times.is_empty() {
        return Err("No frames could be read from the source.".into());
    }
    // A single contact sheet also works with models that accept just one image.
    let pattern = work.path().join("%02d.jpg");
    let sheet = run(
        "ffmpeg",
        &[
            "-v",
            "error",
            "-i",
            pattern.to_str().ok_or("Invalid temporary path.")?,
            "-vf",
            "tile=3x3",
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "pipe:1",
        ],
        45,
    )
    .await?;
    let _ = app.emit(
        "studio-progress",
        "Finding highlights with the local vision model…",
    );
    let prompt = format!("You are a film editor. This 3 by 3 contact sheet shows frames read left to right, then top to bottom, at seconds {} of a {duration:.2} second video. Pick up to three distinct, visually interesting, non-overlapping clips grounded in these frames. Give each a specific short title, start and end in seconds. Use only times inside the source. Return JSON: {{\"clips\":[{{\"title\":\"...\",\"start\":0.0,\"end\":1.0}}]}}.",times.join(", "));
    let response = client.post("http://127.0.0.1:11434/api/generate")
        .json(&json!({"model":model,"stream":false,"format":"json","images":[STANDARD.encode(sheet)],"prompt":prompt,"options":{"temperature":0.2}}))
        .send().await.map_err(|_| "Local analysis did not finish. Check Ollama and try a smaller vision model.")?;
    if !response.status().is_success() {
        return Err("Ollama could not analyze these frames. Check the model's vision support and available memory.".into());
    }
    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Invalid Ollama response.")?;
    #[derive(Deserialize)]
    struct Answer {
        clips: Vec<Suggestion>,
    }
    let answer: Answer = serde_json::from_str(data["response"].as_str().unwrap_or(""))
        .map_err(|_| "The model could not identify usable clips. Try again.")?;
    let mut clips: Vec<Suggestion> = Vec::new();
    for mut c in answer.clips {
        c.title = c.title.trim().chars().take(64).collect();
        if !c.title.is_empty()
            && valid_range(c.start, c.end, duration)
            && clips.iter().all(|x| x.end <= c.start || c.end <= x.start)
        {
            clips.push(c);
            if clips.len() == 3 {
                break;
            }
        }
    }
    if clips.is_empty() {
        return Err(
            "No usable highlight ranges were found. You can still mark a clip manually.".into(),
        );
    }
    Ok(clips)
}
