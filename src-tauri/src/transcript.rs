//! Every imported video's transcript, made once after it opens (clip-ai service/pipeline.py transcribe_file): its audio
//! as 16 kHz mono MP3 in 10-minute parts, sent a few at a time to Whisper on the user's OpenRouter or Cloudflare, each part
//! kept as it returns so an interrupted run sends only the parts still missing. Every clip's captions come from it, and the
//! studio's Transcript tab reads, searches, and corrects it (corrections live in the project, not in this file).
use crate::captions::{transcript_language, transcript_words, Word};
use crate::media::{probe, root, run, text, Result};
use crate::providers::{Connection, Session};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::{fs, sync::watch};
use uuid::Uuid;

/// The audio sent at once (clip-ai TRANSCRIPTION_CHUNK_SECONDS).
const PART_SECONDS: f64 = 600.0;
/// Parts in flight (clip-ai TRANSCRIPTION_CONCURRENCY).
const CONCURRENCY: usize = 3;
/// Tries per part on a timeout, a network error, a rate limit, or a provider error (clip-ai TRANSCRIPTION_ATTEMPTS).
const ATTEMPTS: usize = 4;
const BACKOFF_SECONDS: [u64; 3] = [2, 8, 20];
const DONE: &str = "transcript.json";
const PARTS: &str = "transcript-parts";

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// What was said, on the source clock: Whisper's segments (the Transcript tab's lines) and its timed words (captions).
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Transcript {
    pub language: Option<String>,
    pub segments: Vec<Segment>,
    pub words: Vec<Word>,
}

/// Transcripts being made, by project id, so deleting the project stops them first (as its waveform).
static RUNNING: LazyLock<Mutex<HashMap<String, watch::Sender<bool>>>> =
    LazyLock::new(Default::default);

fn project_key(id: &str) -> Result<String> {
    Ok(Uuid::parse_str(id)
        .map_err(|_| "Unknown project.")?
        .to_string())
}

/// The project's transcript: read from disk when made, else made now. Progress goes out as `studio-transcript`
/// events: `{id, done, total}` parts.
pub async fn transcribe_source(
    app: AppHandle,
    id: String,
    connection: Connection,
    language: Option<String>,
    again: bool,
) -> Result<Transcript> {
    let key = project_key(&id)?;
    let folder = root(&app)?.join(&key);
    // Only a two-letter code reaches Whisper; anything else is detected (ClipCheap's job option `language`).
    let language =
        language.filter(|code| code.len() == 2 && code.bytes().all(|b| b.is_ascii_lowercase()));
    if again {
        if RUNNING
            .lock()
            .map_err(|_| "Transcript state unavailable.")?
            .contains_key(&key)
        {
            return Err("This video is already being transcribed.".into());
        }
        let _ = fs::remove_file(folder.join(DONE)).await;
        let _ = fs::remove_dir_all(folder.join(PARTS)).await;
    } else if let Some(done) = read_done(&folder).await {
        return Ok(done);
    }
    let session = Session::new(connection, None).await?;
    let events = app.clone();
    transcribe_into(
        &folder,
        &key,
        &session,
        PART_SECONDS,
        language.as_deref(),
        move |done, total| {
            let _ = events.emit(
                "studio-transcript",
                serde_json::json!({ "id": id, "done": done, "total": total }),
            );
        },
    )
    .await
}

/// The project's transcript when it has been made.
pub async fn read_transcript(app: AppHandle, id: String) -> Result<Option<Transcript>> {
    Ok(read_done(&root(&app)?.join(project_key(&id)?)).await)
}

async fn read_done(folder: &Path) -> Option<Transcript> {
    let bytes = fs::read(folder.join(DONE)).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn stop_transcript(key: &str) {
    if let Some(stop) = RUNNING
        .lock()
        .ok()
        .and_then(|mut running| running.remove(key))
    {
        let _ = stop.send(true);
    }
}

/// A timeout, a network failure, a rate limit, or a server error: worth another try (clip-ai transcribe_chunk).
fn transient(error: &str) -> bool {
    error.contains("timed out")
        || error.contains("Could not reach")
        || [
            " returned 408",
            " returned 409",
            " returned 429",
            " returned 5",
        ]
        .iter()
        .any(|code| error.contains(code))
}

async fn part(session: &Session, file: &Path, language: Option<&str>) -> Result<Value> {
    let mp3 = fs::read(file).await.map_err(|e| e.to_string())?;
    let mut attempt = 0;
    loop {
        match session.transcribe(&mp3, language).await {
            Ok(value) => return Ok(value),
            Err(error) if attempt + 1 < ATTEMPTS && transient(&error) => {
                tokio::time::sleep(Duration::from_secs(BACKOFF_SECONDS[attempt])).await;
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

/// A part's segments moved onto the source clock (clip-ai rebase_segments).
fn segments_of(transcript: &Value, offset: f64) -> Vec<Segment> {
    transcript["segments"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let text = s["text"]
                .as_str()?
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            let (start, end) = (s["start"].as_f64()?, s["end"].as_f64()?);
            (!text.is_empty() && start.is_finite() && end >= start).then(|| Segment {
                start: round3(start + offset),
                end: round3(end + offset),
                text,
            })
        })
        .collect()
}

async fn transcribe_into(
    folder: &Path,
    key: &str,
    session: &Session,
    part_seconds: f64,
    language: Option<&str>,
    progress: impl Fn(usize, usize),
) -> Result<Transcript> {
    if let Some(done) = read_done(folder).await {
        return Ok(done);
    }
    let video = folder.join("source.mp4");
    let (duration, .., audio) = probe(&video).await?;
    if !audio {
        // Nothing to hear: an empty transcript, kept so the studio stops asking.
        let empty = Transcript::default();
        write_done(folder, &empty).await?;
        return Ok(empty);
    }
    let (stop, mut stopped) = watch::channel(false);
    {
        let mut running = RUNNING
            .lock()
            .map_err(|_| "Transcript state unavailable.")?;
        if running.contains_key(key) {
            return Err("This video is already being transcribed.".into());
        }
        running.insert(key.to_owned(), stop);
    }
    // Dropping the work when stopped kills its ffmpeg and aborts the parts in flight.
    let made = tokio::select! {
        biased;
        _ = stopped.changed() => Err("Transcription stopped.".to_string()),
        made = make(folder, &video, duration, session, part_seconds, language, &progress) => made,
    };
    if let Ok(mut running) = RUNNING.lock() {
        running.remove(key);
    }
    made
}

async fn make(
    folder: &Path,
    video: &Path,
    duration: f64,
    session: &Session,
    part_seconds: f64,
    language: Option<&str>,
    progress: &impl Fn(usize, usize),
) -> Result<Transcript> {
    let kept = folder.join(PARTS);
    // Parts kept from a run in another language are no use to this one.
    let marker = kept.join("language");
    let wanted = language.unwrap_or("auto");
    if fs::read_to_string(&marker)
        .await
        .is_ok_and(|was| was != wanted)
    {
        let _ = fs::remove_dir_all(&kept).await;
    }
    fs::create_dir_all(&kept).await.map_err(|e| e.to_string())?;
    fs::write(&marker, wanted)
        .await
        .map_err(|e| e.to_string())?;
    // The audio alone, split as it is written: one pass over the source, however long.
    let audio = tempfile::tempdir().map_err(|e| e.to_string())?;
    let pattern = audio.path().join("%03d.mp3");
    let seconds = format!("{part_seconds}");
    run(
        "ffmpeg",
        &[
            "-v",
            "error",
            "-nostdin",
            "-i",
            text(video)?,
            "-map",
            "0:a:0",
            "-map_metadata",
            "-1",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "32k",
            "-f",
            "segment",
            "-segment_time",
            &seconds,
            "-reset_timestamps",
            "1",
            text(&pattern)?,
        ],
        ((duration / 10.0).max(300.0)) as u64,
    )
    .await?;
    let total = (0..)
        .take_while(|index| audio.path().join(format!("{index:03}.mp3")).is_file())
        .count();
    if total == 0 {
        return Err("The video's sound could not be read.".into());
    }
    let mut results: Vec<Option<Value>> = vec![None; total];
    for (index, slot) in results.iter_mut().enumerate() {
        if let Ok(bytes) = fs::read(kept.join(format!("{index:03}.json"))).await {
            *slot = serde_json::from_slice(&bytes).ok();
        }
    }
    let mut done = results.iter().filter(|r| r.is_some()).count();
    progress(done, total);
    let mut pending: VecDeque<usize> = (0..total).filter(|&i| results[i].is_none()).collect();
    let mut flight = tokio::task::JoinSet::new();
    loop {
        while flight.len() < CONCURRENCY {
            let Some(index) = pending.pop_front() else {
                break;
            };
            let (session, file, language) = (
                session.clone(),
                audio.path().join(format!("{index:03}.mp3")),
                language.map(str::to_owned),
            );
            flight.spawn(async move { (index, part(&session, &file, language.as_deref()).await) });
        }
        let Some(joined) = flight.join_next().await else {
            break;
        };
        // The first failure ends the run; the parts already kept stay for the next one.
        let (index, value) = joined.map_err(|e| e.to_string())?;
        let value = value?;
        fs::write(
            kept.join(format!("{index:03}.json")),
            serde_json::to_vec(&value).map_err(|e| e.to_string())?,
        )
        .await
        .map_err(|e| e.to_string())?;
        results[index] = Some(value);
        done += 1;
        progress(done, total);
    }
    let mut transcript = Transcript::default();
    for (index, value) in results.iter().enumerate() {
        let Some(value) = value else {
            return Err("A part of the transcript is missing. Try again.".into());
        };
        let offset = index as f64 * part_seconds;
        transcript.words.extend(transcript_words(value, offset));
        transcript.segments.extend(segments_of(value, offset));
        transcript.language = transcript.language.or_else(|| transcript_language(value));
    }
    // A language the user chose wins over what Whisper guessed, so the captions take that face.
    if let Some(code) = language {
        transcript.language = Some(code.to_owned());
    }
    write_done(folder, &transcript).await?;
    let _ = fs::remove_dir_all(&kept).await;
    Ok(transcript)
}

/// Written whole and then renamed, so a transcript on disk is never half a file.
async fn write_done(folder: &Path, transcript: &Transcript) -> Result<()> {
    let partial = folder.join(format!("{DONE}.part"));
    fs::write(
        &partial,
        serde_json::to_vec(transcript).map_err(|e| e.to_string())?,
    )
    .await
    .map_err(|e| e.to_string())?;
    fs::rename(&partial, folder.join(DONE))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::Provider;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tiny_http::{Response, Server};

    async fn talk(folder: &Path, seconds: &str) {
        std::fs::create_dir_all(folder).unwrap();
        run(
            "ffmpeg",
            &[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                &format!("color=c=black:s=160x90:r=10:d={seconds}"),
                "-f",
                "lavfi",
                "-i",
                &format!("sine=f=300:r=48000:d={seconds}"),
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                "-shortest",
                text(&folder.join("source.mp4")).unwrap(),
            ],
            60,
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn a_whole_video_is_transcribed_in_parts_and_resumes_where_it_stopped() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("project");
        talk(&folder, "5").await;
        let server = Server::http("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.server_addr());
        let asked = Arc::new(AtomicUsize::new(0));
        let counter = asked.clone();
        std::thread::spawn(move || {
            for mut request in server.incoming_requests() {
                let mut body = String::new();
                request.as_reader().read_to_string(&mut body).unwrap();
                counter.fetch_add(1, Ordering::SeqCst);
                let answer = serde_json::json!({"result":{"transcription_info":{"language":"en"},"segments":[
                    {"start":0.1,"end":0.9,"text":" Hi there.","words":[{"word":"Hi","start":0.1,"end":0.4},{"word":"there.","start":0.4,"end":0.9}]}]}});
                request
                    .respond(Response::from_string(answer.to_string()))
                    .unwrap();
            }
        });
        let session = Session::new(
            Connection {
                provider: Provider::Cloudflare,
                port: None,
                account_id: Some("a".repeat(32)),
                gateway: None,
                model: None,
            },
            Some("fixture-token"),
        )
        .await
        .unwrap()
        .with_base(base);
        // One part already kept from an earlier, interrupted run: only the others are sent.
        std::fs::create_dir_all(folder.join(PARTS)).unwrap();
        std::fs::write(
            folder.join(PARTS).join("001.json"),
            r#"{"segments":[{"start":0.2,"end":0.5,"text":"Kept.","words":[{"word":"Kept.","start":0.2,"end":0.5}]}]}"#,
        )
        .unwrap();
        let seen = Mutex::new(Vec::new());
        let transcript = transcribe_into(&folder, "resume", &session, 2.0, None, |done, total| {
            seen.lock().unwrap().push((done, total))
        })
        .await
        .unwrap();
        // Five seconds in two-second parts: three parts, the middle one already kept.
        assert_eq!(asked.load(Ordering::SeqCst), 2);
        assert_eq!(seen.lock().unwrap().first(), Some(&(1, 3)));
        assert_eq!(seen.lock().unwrap().last(), Some(&(3, 3)));
        let texts: Vec<(f64, &str)> = transcript
            .words
            .iter()
            .map(|w| (w.start, w.text.as_str()))
            .collect();
        assert_eq!(
            texts,
            vec![
                (0.1, "Hi"),
                (0.4, "there."),
                (2.2, "Kept."),
                (4.1, "Hi"),
                (4.4, "there.")
            ]
        );
        assert_eq!(transcript.segments.len(), 3);
        assert_eq!(transcript.segments[1].start, 2.2);
        assert_eq!(transcript.language.as_deref(), Some("en"));
        assert!(folder.join(DONE).is_file());
        assert!(!folder.join(PARTS).exists());
        // Made once: the next call reads it back without asking again.
        let again = transcribe_into(&folder, "resume", &session, 2.0, None, |_, _| {})
            .await
            .unwrap();
        assert_eq!(again, transcript);
        assert_eq!(asked.load(Ordering::SeqCst), 2);
    }

    /// A 31-minute recording goes to a Whisper server on this computer in four ten-minute parts,
    /// each an OpenAI-style upload, and its words come back on the recording's own clock.
    #[tokio::test]
    async fn a_long_recording_is_transcribed_in_ten_minute_parts_on_a_local_server() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("long");
        std::fs::create_dir_all(&folder).unwrap();
        run(
            "ffmpeg",
            &[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=64x36:r=1:d=1860",
                "-f",
                "lavfi",
                "-i",
                "sine=f=300:r=8000:d=1860",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-c:a",
                "aac",
                "-b:a",
                "16k",
                "-shortest",
                text(&folder.join("source.mp4")).unwrap(),
            ],
            300,
        )
        .await
        .unwrap();
        let server = Server::http("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.server_addr());
        let asked = Arc::new(AtomicUsize::new(0));
        let counter = asked.clone();
        std::thread::spawn(move || {
            for mut request in server.incoming_requests() {
                assert_eq!(request.url(), "/v1/audio/transcriptions");
                let mut body = Vec::new();
                request.as_reader().read_to_end(&mut body).unwrap();
                assert!(String::from_utf8_lossy(&body).contains("filename=\"audio.mp3\""));
                counter.fetch_add(1, Ordering::SeqCst);
                let answer = serde_json::json!({"language":"english","text":"Part.",
                    "segments":[{"start":1.0,"end":1.5,"text":"Part."}],
                    "words":[{"word":"Part.","start":1.0,"end":1.5}]});
                request
                    .respond(Response::from_string(answer.to_string()))
                    .unwrap();
            }
        });
        let session = Session::new(
            Connection {
                provider: Provider::Whisper,
                port: Some(9),
                account_id: None,
                gateway: None,
                model: None,
            },
            None,
        )
        .await
        .unwrap()
        .with_base(base);
        let seen = Mutex::new(Vec::new());
        let transcript = transcribe_into(
            &folder,
            "long",
            &session,
            PART_SECONDS,
            None,
            |done, total| seen.lock().unwrap().push((done, total)),
        )
        .await
        .unwrap();
        assert_eq!(asked.load(Ordering::SeqCst), 4);
        assert_eq!(seen.lock().unwrap().last(), Some(&(4, 4)));
        let starts: Vec<f64> = transcript.words.iter().map(|w| w.start).collect();
        assert_eq!(starts, vec![1.0, 601.0, 1201.0, 1801.0]);
        assert_eq!(transcript.segments.len(), 4);
    }

    #[tokio::test]
    async fn a_silent_video_keeps_an_empty_transcript_and_a_deleted_one_stops() {
        let tmp = tempfile::tempdir().unwrap();
        let silent = tmp.path().join("silent");
        std::fs::create_dir_all(&silent).unwrap();
        run(
            "ffmpeg",
            &[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=160x90:r=10:d=1",
                "-c:v",
                "libx264",
                text(&silent.join("source.mp4")).unwrap(),
            ],
            60,
        )
        .await
        .unwrap();
        let session = Session::new(
            Connection {
                provider: Provider::Cloudflare,
                port: None,
                account_id: Some("a".repeat(32)),
                gateway: None,
                model: None,
            },
            Some("fixture-token"),
        )
        .await
        .unwrap()
        // Nothing listens here: a request would fail, and none is made.
        .with_base("http://127.0.0.1:9".into());
        let empty = transcribe_into(&silent, "silent", &session, 600.0, None, |_, _| {})
            .await
            .unwrap();
        assert_eq!(empty, Transcript::default());
        assert!(silent.join(DONE).is_file());
        let loud = tmp.path().join("loud");
        talk(&loud, "3").await;
        let running = tokio::spawn({
            let (loud, session) = (loud.clone(), session.clone());
            async move { transcribe_into(&loud, "loud", &session, 600.0, None, |_, _| {}).await }
        });
        while !RUNNING.lock().unwrap().contains_key("loud") {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        stop_transcript("loud");
        assert_eq!(
            running.await.unwrap(),
            Err("Transcription stopped.".to_string())
        );
        assert!(!loud.join(DONE).exists());
    }

    #[test]
    fn only_passing_failures_are_tried_again() {
        assert!(transient(
            "Cloudflare AI Gateway timed out. Check the server."
        ));
        assert!(transient(
            "OpenRouter returned 429. The rate limit was reached."
        ));
        assert!(transient(
            "OpenRouter returned 503. Check provider availability."
        ));
        assert!(!transient("OpenRouter returned 401. Check your API token."));
        assert!(!transient("Cloudflare AI Gateway returned 400. Bad audio."));
    }
}
