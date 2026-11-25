use crate::highlights;
use crate::media::{probe, run, source, valid_range, Result};
use crate::progress::{clock, Tracker};
use crate::providers::{Connection, Session};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize)]
pub struct Suggestion {
    title: String,
    start: f64,
    end: f64,
}

/// Highlights from what was said when the video has a transcript, as ClipCheap finds them (highlights.rs); else from nine
/// frames across it, for a video with no speech or one not transcribed yet.
pub async fn find_highlights(
    app: AppHandle,
    id: String,
    connection: Connection,
    model: String,
) -> Result<Vec<Suggestion>> {
    if let Ok(Some(transcript)) = crate::transcript::read_transcript(app.clone(), id.clone()).await
    {
        let lines = highlights::transcript_lines(&transcript);
        if !lines.is_empty() {
            return from_transcript(&app, &id, connection, &model, &lines).await;
        }
    }
    from_frames(app, id, connection, model).await
}

async fn from_transcript(
    app: &AppHandle,
    id: &str,
    connection: Connection,
    model: &str,
    lines: &[highlights::Line],
) -> Result<Vec<Suggestion>> {
    let name = connection.label();
    let events = app.clone();
    let mut track = Tracker::new(vec!["Read transcript", "Find highlights"], move |step| {
        let _ = events.emit("studio-step", step);
    });
    track.show("Read transcript", "Connecting", None, None);
    let session = Session::new(connection, None).await?;
    let (duration, ..) = probe(&source(app, id)?).await?;
    let text = highlights::prompt_lines(lines);
    if text.len() > highlights::MAX_PROMPT_CHARS {
        return Err(
            "This video's transcript is too long to read at once. Mark clips by hand, or split the video.".into(),
        );
    }
    track.about(format!("{} transcript · {model}", clock(duration)));
    track.show(
        "Find highlights",
        format!("Waiting for {name}"),
        None,
        Some(format!(
            "The model is reading {} sentences of transcript",
            lines.len()
        )),
    );
    let asked = Instant::now();
    let answer = session
        .chat(
            model,
            &highlights::system_prompt(duration, 3),
            &format!("<transcript>\n{text}\n</transcript>"),
        )
        .await?;
    eprintln!(
        "[highlights] transcript of {} lines, {name} {model} {:.1}s",
        lines.len(),
        asked.elapsed().as_secs_f64()
    );
    let picks =
        highlights::select_highlights(&highlights::parse_candidates(&answer)?, lines, duration, 3);
    if picks.is_empty() {
        return Err(format!(
            "No self-contained moments of {:.0} to {:.0} seconds were found. Try again, or mark a clip by hand.",
            highlights::MIN_SECONDS,
            highlights::MAX_SECONDS
        ));
    }
    Ok(picks
        .into_iter()
        .map(|p| Suggestion {
            title: p.title,
            start: p.start,
            end: p.end,
        })
        .collect())
}

async fn from_frames(
    app: AppHandle,
    id: String,
    connection: Connection,
    model: String,
) -> Result<Vec<Suggestion>> {
    let name = connection.label();
    let events = app.clone();
    let mut track = Tracker::new(vec!["Sample frames", "Find highlights"], move |step| {
        let _ = events.emit("studio-step", step);
    });
    track.show("Sample frames", "Connecting", None, None);
    let session = Session::new(connection, None).await?;
    let path = source(&app, &id)?;
    let (duration, ..) = probe(&path).await?;
    track.about(format!("{} source · {model}", clock(duration)));
    track.show(
        "Sample frames",
        "Sampling 9 frames across the video",
        None,
        None,
    );
    let started = Instant::now();
    let input = path.to_str().ok_or("Invalid source path.")?.to_owned();
    // All nine at once. Dropping the set (a cancelled job) aborts the tasks and their ffmpeg.
    let mut grabs = tokio::task::JoinSet::new();
    for i in 0..9 {
        let time = duration * i as f64 / 9.0;
        let input = input.clone();
        grabs.spawn(async move {
            let jpeg = run(
                "ffmpeg",
                &[
                    "-v",
                    "error",
                    "-ss",
                    &time.to_string(),
                    "-i",
                    &input,
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
            .await;
            (i, time, jpeg)
        });
    }
    let mut sampled = Vec::new();
    while let Some(grab) = grabs.join_next().await {
        let (i, time, jpeg) = grab.map_err(|e| e.to_string())?;
        sampled.push((i, time, jpeg?));
        track.show(
            "Sample frames",
            "Sampling 9 frames across the video",
            Some(sampled.len() as f64 / 9.0),
            Some(format!("{} of 9 frames", sampled.len())),
        );
    }
    sampled.sort_by_key(|(i, ..)| *i);
    let work = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut times = Vec::new();
    for (_, time, jpeg) in sampled {
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
    let sampling = started.elapsed();
    track.show(
        "Find highlights",
        format!("Waiting for {name}"),
        None,
        Some(format!(
            "The model is reading a contact sheet of {} frames",
            times.len()
        )),
    );
    let asked = Instant::now();
    let prompt = format!("You are a film editor. This 3 by 3 contact sheet shows frames read left to right, then top to bottom, at seconds {} of a {duration:.2} second video. Pick up to three distinct, visually interesting, non-overlapping clips grounded in these frames. Give each a specific short title, start and end in seconds. Use only times inside the source. Return JSON: {{\"clips\":[{{\"title\":\"...\",\"start\":0.0,\"end\":1.0}}]}}.",times.join(", "));
    let response = session
        .generate(&model, &prompt, STANDARD.encode(sheet))
        .await?;
    eprintln!(
        "[highlights] frames {:.1}s, {name} {model} {:.1}s",
        sampling.as_secs_f64(),
        asked.elapsed().as_secs_f64()
    );
    let text = response.trim();
    let text = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```"))
        .and_then(|s| s.strip_suffix("```"))
        .unwrap_or(text)
        .trim();
    #[derive(Deserialize)]
    struct Answer {
        clips: Vec<Suggestion>,
    }
    let answer: Answer = serde_json::from_str(text)
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
