use serde::Serialize;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::{fs, process::Command, time::timeout};
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, String>;
const MAX_DURATION: f64 = 7200.0;
pub const FRAME_COUNT: usize = 9;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    id: String,
    title: String,
    path: PathBuf,
    frames: Vec<PathBuf>,
    wave: Option<PathBuf>,
    duration: f64,
    width: u64,
    height: u64,
    fps: f64,
}

pub async fn run(tool: &str, args: &[&str], seconds: u64) -> Result<Vec<u8>> {
    let mut command = Command::new(tool);
    command
        .args(args)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = timeout(Duration::from_secs(seconds), command.output())
        .await
        .map_err(|_| format!("{tool} timed out. Try a shorter video."))?
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!("Install {tool} and add it to your PATH, then restart Quikclip.")
            } else {
                format!("Could not start {tool}: {e}")
            }
        })?;
    if !output.status.success() {
        let diagnostic = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "{tool}: {}",
            diagnostic
                .trim()
                .lines()
                .rev()
                .take(3)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(600)
                .collect::<String>()
        ));
    }
    Ok(output.stdout)
}

fn text(path: &Path) -> Result<&str> {
    path.to_str()
        .ok_or_else(|| "This file path cannot be represented as text.".into())
}
fn root(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("media"))
}
pub fn source(app: &AppHandle, id: &str) -> Result<PathBuf> {
    if id == "sample" {
        return Ok(app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("sample/alpine.mp4"));
    }
    let uuid = Uuid::parse_str(id).map_err(|_| "Unknown source.")?;
    Ok(root(app)?.join(uuid.to_string()).join("source.mp4"))
}

pub async fn probe(path: &Path) -> Result<(f64, u64, u64, f64, bool)> {
    let bytes = run(
        "ffprobe",
        &[
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            "-i",
            text(path)?,
        ],
        30,
    )
    .await?;
    let data: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid media metadata.")?;
    let streams = data["streams"].as_array().ok_or("No media streams.")?;
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1)
        .ok_or("Choose a file with a video track.")?;
    let duration: f64 = data["format"]["duration"]
        .as_str()
        .unwrap_or("")
        .parse()
        .map_err(|_| "Unknown video duration.")?;
    if !duration.is_finite() || !(0.25..=MAX_DURATION).contains(&duration) {
        return Err("Choose a video between 0.25 seconds and two hours long.".into());
    }
    let fps = video["avg_frame_rate"]
        .as_str()
        .and_then(|s| s.split_once('/'))
        .and_then(|(a, b)| Some(a.parse::<f64>().ok()? / b.parse::<f64>().ok()?))
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(30.0);
    Ok((
        duration,
        video["width"].as_u64().unwrap_or(0),
        video["height"].as_u64().unwrap_or(0),
        fps,
        streams.iter().any(|s| s["codec_type"] == "audio"),
    ))
}

async fn ingest(app: &AppHandle, input: &Path, title: String) -> Result<Media> {
    ingest_into(&root(app)?, input, title, |message| {
        let _ = app.emit("studio-progress", message);
    })
    .await
}

async fn ingest_into(
    parent: &Path,
    input: &Path,
    title: String,
    progress: impl Fn(String),
) -> Result<Media> {
    probe(input).await?;
    progress("Preparing a compatible editing copy…".into());
    fs::create_dir_all(parent)
        .await
        .map_err(|e| e.to_string())?;
    let stage = tempfile::tempdir_in(parent).map_err(|e| e.to_string())?;
    let video = stage.path().join("source.mp4");
    run("ffmpeg", &["-v","error","-nostdin","-protocol_whitelist","file,pipe","-i",text(input)?,
        "-map","0:V:0","-map","0:a:0?","-vf","scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
        "-c:v","libx264","-crf","20","-preset","veryfast","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart", text(&video)?], 7200).await?;
    let (duration, width, height, fps, audio) = probe(&video).await?;
    let id = Uuid::new_v4().to_string();
    let folder = parent.join(&id);
    let mut frames = Vec::new();
    for i in 0..FRAME_COUNT {
        progress(format!(
            "Extracting preview frame {} of {FRAME_COUNT}…",
            i + 1
        ));
        let name = format!("frame-{i}.jpg");
        run(
            "ffmpeg",
            &[
                "-v",
                "error",
                "-ss",
                &format!("{:.3}", duration * i as f64 / FRAME_COUNT as f64),
                "-i",
                text(&video)?,
                "-frames:v",
                "1",
                "-vf",
                "scale=480:-2",
                text(&stage.path().join(&name))?,
            ],
            60,
        )
        .await?;
        if stage.path().join(&name).is_file() {
            frames.push(folder.join(name));
        }
    }
    let wave = if audio
        && run(
            "ffmpeg",
            &[
                "-v",
                "error",
                "-i",
                text(&video)?,
                "-filter_complex",
                "aresample=8000,showwavespic=s=1000x64:colors=0x94b5ba:scale=sqrt",
                "-frames:v",
                "1",
                text(&stage.path().join("wave.png"))?,
            ],
            300,
        )
        .await
        .is_ok()
    {
        Some(folder.join("wave.png"))
    } else {
        None
    };
    fs::rename(stage.path(), &folder)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Media {
        id,
        title,
        path: folder.join("source.mp4"),
        frames,
        wave,
        duration,
        width,
        height,
        fps,
    })
}

pub async fn import_local(app: AppHandle) -> Result<Option<Media>> {
    let dialog = app
        .dialog()
        .file()
        .add_filter("Video", &["mp4", "mov", "m4v", "mkv", "webm", "avi"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let title = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    ingest(&app, &path, title).await.map(Some)
}

fn youtube(input: &str) -> Result<String> {
    let error = "Enter a YouTube video, Shorts, or youtu.be link.";
    let url = url::Url::parse(input.trim()).map_err(|_| error)?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(error.into());
    }
    let path = url.path();
    let id = match url.host_str() {
        Some("youtu.be") => Some(path.trim_start_matches('/').to_owned()),
        Some("www.youtube.com" | "youtube.com" | "m.youtube.com") if path == "/watch" => url
            .query_pairs()
            .find(|(k, _)| k == "v")
            .map(|(_, v)| v.into_owned()),
        Some("www.youtube.com" | "youtube.com" | "m.youtube.com") => {
            path.strip_prefix("/shorts/").map(str::to_owned)
        }
        _ => None,
    }
    .filter(|s| {
        s.len() == 11
            && s.bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    })
    .ok_or(error)?;
    Ok(format!("https://www.youtube.com/watch?v={id}"))
}

pub async fn import_youtube(app: AppHandle, url: String) -> Result<Media> {
    let url = youtube(&url)?;
    let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let output = run(
        "yt-dlp",
        &[
            "--ignore-config",
            "--no-playlist",
            "--no-progress",
            "--quiet",
            "--no-simulate",
            "--match-filter",
            "!is_live & duration <= 7200",
            "--max-filesize",
            "4G",
            "-f",
            "bv*[height<=1080]+ba/b[height<=1080]",
            "-o",
            text(&temp.path().join("input.%(ext)s"))?,
            "--print",
            "after_move:title",
            "--",
            &url,
        ],
        3600,
    )
    .await?;
    let input = std::fs::read_dir(temp.path())
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|f| f.path())
        .find(|p| p.file_stem().is_some_and(|n| n == "input"))
        .ok_or("No video downloaded. Choose a public video under two hours and 4 GB.")?;
    ingest(
        &app,
        &input,
        String::from_utf8_lossy(&output).trim().to_string(),
    )
    .await
}

pub fn valid_range(start: f64, end: f64, duration: f64) -> bool {
    start.is_finite()
        && end.is_finite()
        && start >= 0.
        && end <= duration + 0.001
        && end - start >= 0.249
}

pub async fn export_clip(
    app: AppHandle,
    id: String,
    title: String,
    start: f64,
    end: f64,
    shape: String,
) -> Result<Option<String>> {
    let input = source(&app, &id)?;
    let (duration, ..) = probe(&input).await?;
    if !valid_range(start, end, duration) {
        return Err("The cut must be inside the source and at least 0.25 seconds long.".into());
    }
    let filter = match shape.as_str() {
        "source" => "setsar=1",
        "vertical" => "crop=w='trunc(min(iw,ih*9/16)/2)*2':h='trunc(min(ih,iw*16/9)/2)*2',setsar=1",
        "square" => "crop='trunc(min(iw,ih)/2)*2':'trunc(min(iw,ih)/2)*2',setsar=1",
        _ => return Err("Unknown aspect ratio.".into()),
    };
    let stem: String = title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .take(64)
        .collect();
    let dialog = app
        .dialog()
        .file()
        .add_filter("MPEG-4 video", &["mp4"])
        .set_file_name(format!("clip-{stem}.mp4"));
    let target = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(target) = target else {
        return Ok(None);
    };
    let target = target.into_path().map_err(|e| e.to_string())?;
    if !target
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("mp4"))
    {
        return Err("Choose a filename ending in .mp4.".into());
    }
    if target.starts_with(root(&app)?) || target == input {
        return Err("Choose a destination outside your source library.".into());
    }
    render(&input, &target, start, end, filter).await?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

async fn render(input: &Path, target: &Path, start: f64, end: f64, filter: &str) -> Result<()> {
    let temp = tempfile::Builder::new()
        .suffix(".mp4")
        .tempfile_in(target.parent().ok_or("Invalid destination.")?)
        .map_err(|e| e.to_string())?
        .into_temp_path();
    run(
        "ffmpeg",
        &[
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-ss",
            &start.to_string(),
            "-i",
            text(input)?,
            "-t",
            &(end - start).to_string(),
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            filter,
            "-c:v",
            "libx264",
            "-crf",
            "18",
            "-preset",
            "fast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            text(&temp)?,
        ],
        7200,
    )
    .await?;
    temp.persist(target).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn exports_a_playable_cropped_range_with_audio() {
        let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/sample/alpine.mp4");
        let tmp = tempfile::tempdir().unwrap();
        let output = tmp.path().join("cut.mp4");
        render(&sample, &output, 2., 3.5, "crop=360:640,setsar=1")
            .await
            .unwrap();
        let (duration, w, h, _, audio) = probe(&output).await.unwrap();
        assert!((duration - 1.5).abs() < 0.1);
        assert_eq!((w, h, audio), (360, 640, true));
        let imported = ingest_into(
            &tmp.path().join("library"),
            &output,
            "Portrait clip".into(),
            |_| {},
        )
        .await
        .unwrap();
        assert!(imported.path.is_file());
        assert_eq!(imported.frames.len(), FRAME_COUNT);
        assert!(imported.frames.iter().all(|p| p.is_file()));
        assert!(imported.wave.unwrap().is_file());
    }
    #[test]
    fn canonical_video_urls_only() {
        let expected = "https://www.youtube.com/watch?v=abc_DEF-123";
        assert_eq!(
            youtube("https://youtu.be/abc_DEF-123?t=9").unwrap(),
            expected
        );
        assert_eq!(
            youtube("https://m.youtube.com/shorts/abc_DEF-123").unwrap(),
            expected
        );
        for invalid in [
            "https://youtube.com.evil.test/watch?v=abc_DEF-123",
            "file:///movie",
            "https://youtube.com/playlist?list=abc",
            "https://youtu.be/abc/DEF-123",
            "https://user@youtu.be/abc_DEF-123",
        ] {
            assert!(youtube(invalid).is_err());
        }
    }
    #[test]
    fn rejects_invalid_cuts() {
        assert!(valid_range(0., 0.25, 2.));
        for (a, b) in [(-1., 1.), (0., 3.), (1., 1.1), (f64::NAN, 1.)] {
            assert!(!valid_range(a, b, 2.));
        }
    }
}
