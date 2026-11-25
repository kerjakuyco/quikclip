use crate::progress::{self, Tracker};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::{
    fs,
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
    time::timeout,
};
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, String>;
/// Clippers work from whole streams and podcasts, so a source can run for hours.
const MAX_DURATION: f64 = 12.0 * 3600.0;
const MAX_MUSIC_BYTES: u64 = 20 * 1024 * 1024;
const MAX_MUSIC_SECONDS: f64 = 20.0 * 60.0;
const MAX_LOGO_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LOGO_SIDE: u32 = 4096;
const MIN_LOGO_SIDE: u32 = 16;
pub const FRAME_COUNT: usize = 9;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    id: String,
    title: String,
    path: PathBuf,
    frames: Vec<PathBuf>,
    /// Drawn after the project opens (`draw_wave`), so a long import is not held up by it. Left
    /// out until then, which the studio reads as "not drawn yet".
    #[serde(skip_serializing_if = "Option::is_none")]
    wave: Option<PathBuf>,
    duration: f64,
    width: u64,
    height: u64,
    fps: f64,
    /// Set for a downloaded link. Local files leave this empty.
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

fn tool_path(tool: &str) -> Result<PathBuf> {
    let suffix = std::env::consts::EXE_SUFFIX;
    #[cfg(test)]
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "quikclip-{tool}-{}{suffix}",
            env!("QUIKCLIP_TARGET")
        ));
    #[cfg(not(test))]
    let path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name(format!("quikclip-{tool}{suffix}"));
    if !path.is_file() {
        return Err(format!("Quikclip’s bundled {tool} is missing. Reinstall the desktop app to restore its media tools."));
    }
    Ok(path)
}

fn tool_error(tool: &str, stderr: &[u8]) -> String {
    let diagnostic = String::from_utf8_lossy(stderr);
    format!(
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
    )
}

async fn command_output(tool: &str, args: &[&str], seconds: u64) -> Result<std::process::Output> {
    command_output_in(None, tool, args, seconds).await
}

/// `cwd` lets a filter name its files relatively. Paths inside a filter graph need escaping that breaks on
/// drive letters and quotes; plain names in the tool's own folder do not.
async fn command_output_in(
    cwd: Option<&Path>,
    tool: &str,
    args: &[&str],
    seconds: u64,
) -> Result<std::process::Output> {
    let mut command = Command::new(tool_path(tool)?);
    command
        .args(args)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null());
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    timeout(Duration::from_secs(seconds), command.output())
        .await
        .map_err(|_| format!("{tool} timed out. Try a shorter video."))?
        .map_err(|e| start_error(tool, e))
}

fn start_error(tool: &str, e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        format!(
            "The bundled {tool} could not be opened. Reinstall Quikclip to restore its media tools."
        )
    } else {
        format!("Could not start {tool}: {e}")
    }
}

/// Runs a tool and hands each stdout line to `line` as it is written. stderr is kept for the error.
async fn run_lines(
    tool: &str,
    args: &[&str],
    seconds: u64,
    mut line: impl FnMut(&str) + Send,
) -> Result<()> {
    let mut command = Command::new(tool_path(tool)?);
    command
        .args(args)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|e| start_error(tool, e))?;
    let (Some(stdout), Some(mut stderr)) = (child.stdout.take(), child.stderr.take()) else {
        return Err(format!("Could not start {tool}."));
    };
    let work = async {
        let mut log = Vec::new();
        let read_out = async {
            let mut out = BufReader::new(stdout);
            let mut buf = Vec::new();
            // Bytes, not `lines()`: a title in another encoding must not stop the reader and stall the tool.
            while out.read_until(b'\n', &mut buf).await.is_ok_and(|n| n > 0) {
                line(String::from_utf8_lossy(&buf).trim_end());
                buf.clear();
            }
        };
        let _ = tokio::join!(read_out, stderr.read_to_end(&mut log));
        (child.wait().await, log)
    };
    let (status, log) = timeout(Duration::from_secs(seconds), work)
        .await
        .map_err(|_| format!("{tool} timed out. Try a shorter video."))?;
    if !status
        .map_err(|e| format!("Could not run {tool}: {e}"))?
        .success()
    {
        return Err(tool_error(tool, &log));
    }
    Ok(())
}

/// ffmpeg with `-progress`, reported against the source length.
async fn encode(args: &[&str], duration: f64, label: &str, track: &mut Tracker<'_>) -> Result<()> {
    let mut with = vec!["-progress", "pipe:1", "-nostats"];
    with.extend_from_slice(args);
    let mut state = progress::Encode::default();
    track.show("Editing copy", label, Some(0.0), None);
    // A copy takes seconds. A re-encode of a long source on a slow machine can take hours.
    let limit = (duration * 4.0).max(7200.0) as u64;
    run_lines("ffmpeg", &with, limit, |line| {
        if let Some((done, speed)) = state.line(line) {
            track.show(
                "Editing copy",
                label,
                Some(done / duration),
                Some(progress::encode_detail(done, duration, speed)),
            );
        }
    })
    .await
}

pub async fn run(tool: &str, args: &[&str], seconds: u64) -> Result<Vec<u8>> {
    run_in(None, tool, args, seconds).await
}

async fn run_in(cwd: Option<&Path>, tool: &str, args: &[&str], seconds: u64) -> Result<Vec<u8>> {
    let output = command_output_in(cwd, tool, args, seconds).await?;
    if !output.status.success() {
        return Err(tool_error(tool, &output.stderr));
    }
    Ok(output.stdout)
}

/// ffmpeg's log. silencedetect writes its spans to stderr and still exits 0.
async fn run_log(tool: &str, args: &[&str], seconds: u64) -> Result<String> {
    let output = command_output(tool, args, seconds).await?;
    if !output.status.success() {
        return Err(tool_error(tool, &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stderr).into_owned())
}

pub(crate) fn text(path: &Path) -> Result<&str> {
    path.to_str()
        .ok_or_else(|| "This file path cannot be represented as text.".into())
}
pub(crate) fn root(app: &AppHandle) -> Result<PathBuf> {
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
        return Err("Choose a video between 0.25 seconds and 12 hours long.".into());
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

const IMPORT_SCALE: &str = "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1";

struct ImportEncoder {
    /// Shown while importing.
    name: &'static str,
    codec: &'static str,
    args: &'static [&'static str],
}

/// Software H.264. These flags are the command older imports used.
const SOFTWARE_ENCODER: ImportEncoder = ImportEncoder {
    name: "x264 (software)",
    codec: "libx264",
    // superfast re-encodes about a fifth faster than veryfast. The editing copy is larger, but
    // exports are encoded again from it, so its size does not reach the finished clip.
    args: &["-crf", "20", "-preset", "superfast"],
};

const HARDWARE_ENCODERS: &[ImportEncoder] = &[
    ImportEncoder {
        name: "NVIDIA NVENC",
        codec: "h264_nvenc",
        args: &["-preset", "p4", "-rc", "vbr", "-cq", "20", "-b:v", "0"],
    },
    ImportEncoder {
        name: "AMD AMF",
        codec: "h264_amf",
        args: &[
            "-usage",
            "transcoding",
            "-quality",
            "speed",
            "-rc",
            "cqp",
            "-qp_i",
            "20",
            "-qp_p",
            "20",
            "-profile",
            "high",
        ],
    },
    ImportEncoder {
        name: "Intel Quick Sync",
        codec: "h264_qsv",
        args: &["-preset", "veryfast", "-global_quality", "20"],
    },
    ImportEncoder {
        name: "Apple VideoToolbox",
        codec: "h264_videotoolbox",
        args: &["-b:v", "12M"],
    },
];

static HARDWARE_ENCODER: tokio::sync::OnceCell<Option<&'static ImportEncoder>> =
    tokio::sync::OnceCell::const_new();

/// Codecs the studio's player can play straight from the file, as the webview reports them at
/// import. H.264 always plays. A source in another codec is kept as it is only when the player
/// can play it, so a long recording imports in seconds instead of being re-encoded.
#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Playable {
    pub hevc: bool,
    pub av1: bool,
    pub vp9: bool,
    pub opus: bool,
}

/// The video codec of a source that is copied rather than re-encoded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Codec {
    H264,
    Hevc,
    Av1,
    Vp9,
}

impl Codec {
    fn name(self) -> &'static str {
        match self {
            Codec::H264 => "H.264",
            Codec::Hevc => "HEVC",
            Codec::Av1 => "AV1",
            Codec::Vp9 => "VP9",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CopyPlan {
    /// Copy the video and audio as they are.
    Stream(Codec),
    /// Copy the video and convert the audio to AAC.
    VideoOnly(Codec),
    Transcode,
}

fn import_plan(data: &Value, playable: Playable) -> CopyPlan {
    let Some(streams) = data["streams"].as_array() else {
        return CopyPlan::Transcode;
    };
    let Some(video) = streams.iter().find(|stream| {
        stream["codec_type"] == "video" && stream["disposition"]["attached_pic"] != 1
    }) else {
        return CopyPlan::Transcode;
    };
    let codec = match video["codec_name"].as_str() {
        Some("h264") => Codec::H264,
        Some("hevc") if playable.hevc => Codec::Hevc,
        Some("av1") if playable.av1 => Codec::Av1,
        Some("vp9") if playable.vp9 => Codec::Vp9,
        _ => return CopyPlan::Transcode,
    };
    if !editable_frame(video) {
        return CopyPlan::Transcode;
    }
    match streams
        .iter()
        .find(|stream| stream["codec_type"] == "audio")
        .map(|audio| &audio["codec_name"])
    {
        Some(audio) if audio == "aac" || (audio == "opus" && playable.opus) => {
            CopyPlan::Stream(codec)
        }
        Some(_) => CopyPlan::VideoOnly(codec),
        None => CopyPlan::Stream(codec),
    }
}

/// 8-bit 4:2:0, upright, square pixels, even sides, and no larger than the 1080p editing size.
fn editable_frame(video: &Value) -> bool {
    if video["pix_fmt"] != "yuv420p" || !upright(video) {
        return false;
    }
    let width = video["width"].as_u64().unwrap_or(0);
    let height = video["height"].as_u64().unwrap_or(0);
    width > 0
        && height > 0
        && width <= 1920
        && height <= 1080
        && width % 2 == 0
        && height % 2 == 0
        && matches!(
            video["sample_aspect_ratio"].as_str().unwrap_or("1:1"),
            "1:1" | "N/A"
        )
}

fn upright(video: &Value) -> bool {
    match video["tags"].get("rotate") {
        Some(Value::String(text)) if text != "0" => return false,
        Some(Value::Number(number)) if number.as_i64() != Some(0) => return false,
        _ => {}
    }
    video["side_data_list"]
        .as_array()
        .into_iter()
        .flatten()
        .all(|item| match item.get("rotation") {
            Some(Value::Number(number)) => {
                number.as_f64().is_none_or(|degrees| degrees.abs() <= 0.5)
            }
            Some(Value::String(text)) => text == "0",
            _ => true,
        })
}

async fn import_copy_plan(path: &Path, playable: Playable) -> CopyPlan {
    let Ok(path) = text(path) else {
        return CopyPlan::Transcode;
    };
    let Ok(bytes) = run(
        "ffprobe",
        &[
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_streams",
            "-of",
            "json",
            "-i",
            path,
        ],
        30,
    )
    .await
    else {
        return CopyPlan::Transcode;
    };
    serde_json::from_slice(&bytes)
        .map(|data| import_plan(&data, playable))
        .unwrap_or(CopyPlan::Transcode)
}

/// Apple's player only opens HEVC in MP4 tagged `hvc1`. Chromium plays either tag.
fn copy_tag(args: &mut Vec<&str>, codec: Codec) {
    if codec == Codec::Hevc {
        args.extend(["-tag:v", "hvc1"]);
    }
}

fn stream_copy_args<'a>(input: &'a str, output: &'a str, codec: Codec) -> Vec<&'a str> {
    let mut args = vec![
        "-v",
        "error",
        "-nostdin",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        input,
        "-map",
        "0:V:0",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
    ];
    copy_tag(&mut args, codec);
    args.extend(["-movflags", "+faststart", output]);
    args
}

fn audio_transcode_args<'a>(input: &'a str, output: &'a str, codec: Codec) -> Vec<&'a str> {
    let mut args = vec![
        "-v",
        "error",
        "-nostdin",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        input,
        "-map",
        "0:V:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
    ];
    copy_tag(&mut args, codec);
    args.extend(["-movflags", "+faststart", output]);
    args
}

fn import_transcode_args<'a>(
    input: &'a str,
    output: &'a str,
    encoder: &'a ImportEncoder,
) -> Vec<&'a str> {
    let mut args = vec![
        "-v",
        "error",
        "-nostdin",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        input,
        "-map",
        "0:V:0",
        "-map",
        "0:a:0?",
        "-vf",
        IMPORT_SCALE,
        "-c:v",
        encoder.codec,
    ];
    args.extend_from_slice(encoder.args);
    args.extend([
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        output,
    ]);
    args
}

async fn encoder_opens(encoder: &ImportEncoder) -> bool {
    let mut args = vec![
        "-v",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x256:r=30:d=0.04",
        "-an",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        encoder.codec,
    ];
    args.extend_from_slice(encoder.args);
    args.extend(["-f", "null", "-"]);
    run("ffmpeg", &args, 30).await.is_ok()
}

async fn hardware_encoder() -> Option<&'static ImportEncoder> {
    *HARDWARE_ENCODER
        .get_or_init(|| async {
            for encoder in HARDWARE_ENCODERS {
                if encoder_opens(encoder).await {
                    return Some(encoder);
                }
            }
            None
        })
        .await
}

/// The stages of a local import. A link import downloads first.
const IMPORT_STEPS: [&str; 2] = ["Editing copy", "Preview frames"];

fn tracker(app: &AppHandle, steps: Vec<&'static str>) -> Tracker<'static> {
    let app = app.clone();
    Tracker::new(steps, move |step| {
        let _ = app.emit("studio-step", step);
    })
}

async fn ingest(
    app: &AppHandle,
    input: &Path,
    title: String,
    playable: Playable,
    track: &mut Tracker<'_>,
) -> Result<Media> {
    ingest_into(&root(app)?, input, title, playable, track).await
}

async fn ingest_into(
    parent: &Path,
    input: &Path,
    title: String,
    playable: Playable,
    track: &mut Tracker<'_>,
) -> Result<Media> {
    track.show("Editing copy", "Reading the video", None, None);
    let (length, width, height, ..) = probe(input).await?;
    let size = fs::metadata(input).await.ok().map(|m| m.len());
    track.about(progress::media_about(&title, width, height, length, size));
    fs::create_dir_all(parent)
        .await
        .map_err(|e| e.to_string())?;
    let stage = tempfile::tempdir_in(parent).map_err(|e| e.to_string())?;
    let video = stage.path().join("source.mp4");
    let source = text(input)?;
    let copy = text(&video)?;
    match import_copy_plan(input, playable).await {
        CopyPlan::Stream(codec) => {
            let label = if codec == Codec::H264 {
                "Copying video and audio (already editable, no re-encode)".to_string()
            } else {
                format!(
                    "Keeping the original {} video and audio (no re-encode)",
                    codec.name()
                )
            };
            encode(
                &stream_copy_args(source, copy, codec),
                length,
                &label,
                track,
            )
            .await?;
        }
        CopyPlan::VideoOnly(codec) => {
            let label = if codec == Codec::H264 {
                "Copying video and converting audio to AAC".to_string()
            } else {
                format!(
                    "Keeping the original {} video, converting audio to AAC",
                    codec.name()
                )
            };
            encode(
                &audio_transcode_args(source, copy, codec),
                length,
                &label,
                track,
            )
            .await?;
        }
        CopyPlan::Transcode => {
            if !HARDWARE_ENCODER.initialized() {
                track.show(
                    "Editing copy",
                    "Checking for a hardware encoder",
                    None,
                    None,
                );
            }
            let software = format!("Re-encoding to H.264 with {}", SOFTWARE_ENCODER.name);
            if let Some(encoder) = hardware_encoder().await {
                let label = format!("Re-encoding to H.264 with {}", encoder.name);
                if encode(
                    &import_transcode_args(source, copy, encoder),
                    length,
                    &label,
                    track,
                )
                .await
                .is_err()
                {
                    let _ = fs::remove_file(&video).await;
                    let label = format!("{} stopped. {software}", encoder.name);
                    encode(
                        &import_transcode_args(source, copy, &SOFTWARE_ENCODER),
                        length,
                        &label,
                        track,
                    )
                    .await?;
                }
            } else {
                encode(
                    &import_transcode_args(source, copy, &SOFTWARE_ENCODER),
                    length,
                    &software,
                    track,
                )
                .await?;
            }
        }
    }
    let (duration, width, height, fps, _) = probe(&video).await?;
    let id = Uuid::new_v4().to_string();
    let folder = parent.join(&id);
    track.show(
        "Preview frames",
        "Saving timeline thumbnails",
        Some(0.0),
        Some(format!("0 of {FRAME_COUNT} thumbnails")),
    );
    // All at once, each from the keyframe nearest its time: one decoded frame per thumbnail, which
    // keeps a long AV1 or HEVC original quick. Dropping the set on cancel stops every ffmpeg.
    let mut grabs = tokio::task::JoinSet::new();
    for i in 0..FRAME_COUNT {
        let at = format!("{:.3}", duration * i as f64 / FRAME_COUNT as f64);
        let input = text(&video)?.to_owned();
        let output = text(&stage.path().join(format!("frame-{i}.jpg")))?.to_owned();
        grabs.spawn(async move {
            run(
                "ffmpeg",
                &[
                    "-v",
                    "error",
                    "-noaccurate_seek",
                    "-ss",
                    &at,
                    "-i",
                    &input,
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=480:-2",
                    &output,
                ],
                60,
            )
            .await
        });
    }
    let mut saved = 0;
    while let Some(grab) = grabs.join_next().await {
        grab.map_err(|e| e.to_string())??;
        saved += 1;
        track.show(
            "Preview frames",
            "Saving timeline thumbnails",
            Some(saved as f64 / FRAME_COUNT as f64),
            Some(format!("{saved} of {FRAME_COUNT} thumbnails")),
        );
    }
    let frames = (0..FRAME_COUNT)
        .map(|i| format!("frame-{i}.jpg"))
        .filter(|name| stage.path().join(name).is_file())
        .map(|name| folder.join(name))
        .collect();
    fs::rename(stage.path(), &folder)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Media {
        id,
        title,
        path: folder.join("source.mp4"),
        frames,
        wave: None,
        duration,
        width,
        height,
        fps,
        source: None,
    })
}

pub async fn import_local(app: AppHandle, playable: Playable) -> Result<Option<Media>> {
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
    let mut track = tracker(&app, IMPORT_STEPS.to_vec());
    ingest(&app, &path, title, playable, &mut track)
        .await
        .map(Some)
}

const YOUTUBE_LINK: &str = "Enter a YouTube video, Shorts, or youtu.be link.";
const TWITCH_LINK: &str = "Enter a Twitch VOD or clip link.";
const KICK_LINK: &str = "Enter a Kick video or clip link.";
const VIDEO_LINK: &str = "Enter a YouTube, Twitch, or Kick link.";

#[derive(Clone, Copy)]
enum Site {
    YouTube,
    Twitch,
    Kick,
}

fn site_of(host: &str) -> Option<Site> {
    match host {
        "youtu.be" | "www.youtube.com" | "youtube.com" | "m.youtube.com" => Some(Site::YouTube),
        "twitch.tv" | "www.twitch.tv" | "m.twitch.tv" | "go.twitch.tv" | "player.twitch.tv"
        | "clips.twitch.tv" => Some(Site::Twitch),
        "kick.com" | "www.kick.com" => Some(Site::Kick),
        _ => None,
    }
}

fn site_error(site: Site) -> &'static str {
    match site {
        Site::YouTube => YOUTUBE_LINK,
        Site::Twitch => TWITCH_LINK,
        Site::Kick => KICK_LINK,
    }
}

/// Canonical public video URL and the project label. The original text is never downloaded.
fn video_link(input: &str) -> Result<(String, &'static str)> {
    let url = url::Url::parse(input.trim()).map_err(|_| VIDEO_LINK.to_string())?;
    let Some(site) = site_of(url.host_str().unwrap_or("")) else {
        return Err(VIDEO_LINK.into());
    };
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(site_error(site).into());
    }
    let canonical = match site {
        Site::YouTube => youtube_url(&url).map(|link| (link, "YouTube")),
        Site::Twitch => twitch_url(&url).map(|link| (link, "Twitch")),
        Site::Kick => kick_url(&url).map(|link| (link, "Kick")),
    };
    canonical.ok_or_else(|| site_error(site).into())
}

fn query_value(url: &url::Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.into_owned())
}

fn path_parts(url: &url::Url) -> Vec<&str> {
    url.path()
        .split('/')
        .filter(|part| !part.is_empty())
        .collect()
}

fn youtube_url(url: &url::Url) -> Option<String> {
    let path = url.path();
    let id = match url.host_str() {
        Some("youtu.be") => Some(path.trim_start_matches('/').to_owned()),
        Some("www.youtube.com" | "youtube.com" | "m.youtube.com") if path == "/watch" => url
            .query_pairs()
            .find(|(key, _)| key == "v")
            .map(|(_, value)| value.into_owned()),
        Some("www.youtube.com" | "youtube.com" | "m.youtube.com") => {
            path.strip_prefix("/shorts/").map(str::to_owned)
        }
        _ => None,
    }
    .filter(|id| {
        id.len() == 11
            && id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    })?;
    Some(format!("https://www.youtube.com/watch?v={id}"))
}

fn numeric_id(value: &str) -> Option<&str> {
    if (1..=16).contains(&value.len()) && value.bytes().all(|c| c.is_ascii_digit()) {
        Some(value)
    } else {
        None
    }
}

fn twitch_channel(value: &str) -> bool {
    (1..=25).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_')
}

fn twitch_slug(value: &str) -> bool {
    (1..=120).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn twitch_vod(id: &str) -> Option<String> {
    numeric_id(id).map(|id| format!("https://www.twitch.tv/videos/{id}"))
}

fn twitch_clip(slug: &str) -> Option<String> {
    twitch_slug(slug).then(|| format!("https://clips.twitch.tv/{slug}"))
}

fn twitch_url(url: &url::Url) -> Option<String> {
    let host = url.host_str()?;
    let parts = path_parts(url);
    if host == "player.twitch.tv" {
        if !parts.is_empty() {
            return None;
        }
        let raw = query_value(url, "video")?;
        return twitch_vod(raw.strip_prefix('v').unwrap_or(&raw));
    }
    if host == "clips.twitch.tv" {
        return match parts.as_slice() {
            ["embed"] => {
                let slug = query_value(url, "clip")?;
                twitch_clip(&slug)
            }
            [slug] => twitch_clip(slug),
            [channel, slug] if *channel != "embed" && twitch_channel(channel) => twitch_clip(slug),
            _ => None,
        };
    }
    match parts.as_slice() {
        ["videos", id] => twitch_vod(id),
        [channel, "v" | "video", id] if twitch_channel(channel) => twitch_vod(id),
        [channel, "schedule"] if twitch_channel(channel) => {
            let id = query_value(url, "vodID")?;
            twitch_vod(&id)
        }
        ["clip", slug] => twitch_clip(slug),
        [channel, "clip", slug] if twitch_channel(channel) => twitch_clip(slug),
        _ => None,
    }
}

fn kick_slug(value: &str) -> bool {
    (1..=50).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn kick_clip_id(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("clip_") else {
        return false;
    };
    (1..=64).contains(&rest.len())
        && rest
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn kick_vod_id(value: &str) -> Option<String> {
    let mut parts = value.split('-');
    let ok = [8, 4, 4, 4, 12].into_iter().all(|len| {
        parts
            .next()
            .is_some_and(|part| part.len() == len && part.bytes().all(|c| c.is_ascii_hexdigit()))
    }) && parts.next().is_none();
    ok.then(|| value.to_ascii_lowercase())
}

fn kick_url(url: &url::Url) -> Option<String> {
    let parts = path_parts(url);
    match parts.as_slice() {
        [channel, "videos", id] if kick_slug(channel) => {
            let id = kick_vod_id(id)?;
            Some(format!("https://kick.com/{channel}/videos/{id}"))
        }
        [channel, "clips", id] if kick_slug(channel) && kick_clip_id(id) => {
            Some(format!("https://kick.com/{channel}/clips/{id}"))
        }
        [channel] if kick_slug(channel) => {
            let id = query_value(url, "clip")?;
            let channel = *channel;
            kick_clip_id(&id).then(|| format!("https://kick.com/{channel}/clips/{id}"))
        }
        _ => None,
    }
}

pub async fn import_youtube(app: AppHandle, url: String, playable: Playable) -> Result<Media> {
    let (url, source) = video_link(&url)?;
    let mut steps = vec!["Download"];
    steps.extend(IMPORT_STEPS);
    let mut track = tracker(&app, steps);
    track.show("Download", format!("Connecting to {source}"), None, None);
    let ffmpeg = tool_path("ffmpeg")?;
    let js = format!("quickjs:{}", text(&tool_path("qjs")?)?);
    let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut title = String::new();
    run_lines(
        "yt-dlp",
        &[
            "--ignore-config",
            "--no-plugin-dirs",
            "--no-js-runtimes",
            "--js-runtimes",
            &js,
            "--ffmpeg-location",
            text(&ffmpeg)?,
            "--no-playlist",
            "--quiet",
            "--progress",
            "--newline",
            "--progress-template",
            progress::DOWNLOAD_TEMPLATE,
            "--no-simulate",
            "--match-filter",
            "!is_live & duration <= 43200",
            "--max-filesize",
            "50G",
            "-f",
            "bv*[height<=1080]+ba/b[height<=1080]",
            // At the same size and frame rate, take H.264 and AAC. The import then copies the
            // streams instead of re-encoding, which takes seconds on any machine. AV1 and VP9
            // are smaller to download but can take an hour to re-encode on a modest PC.
            "-S",
            // Stereo before codec: a 5.1 track is no use in a short clip.
            "res:1080,fps,vcodec:h264,channels:2,acodec:aac",
            // Twitch and Kick send HLS fragments. Fetching several at once fills the connection.
            "--concurrent-fragments",
            "4",
            "-o",
            text(&temp.path().join("input.%(ext)s"))?,
            "--print",
            progress::VIDEO_TEMPLATE,
            "--print",
            "after_move:qc-title %(title)s",
            "--",
            &url,
        ],
        // A long VOD on a modest connection takes hours. The job can still be cancelled.
        24 * 3600,
        |line| {
            if let Some(name) = line.strip_prefix("qc-title ") {
                title = name.trim().to_string();
            } else if let Some(about) = progress::video_info(line) {
                track.about(about);
                track.show(
                    "Download",
                    format!("Starting the download from {source}"),
                    None,
                    None,
                );
            } else if let Some(d) = progress::download_line(line) {
                let finished = d.fraction().is_some_and(|f| f >= 1.0);
                let label = match (d.audio, finished) {
                    (true, true) => "Joining video and audio",
                    (true, false) => "Downloading audio",
                    (false, _) => "Downloading video",
                };
                track.show("Download", label, d.fraction(), Some(d.detail()));
            }
        },
    )
    .await?;
    let input = std::fs::read_dir(temp.path())
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|f| f.path())
        .find(|p| p.file_stem().is_some_and(|n| n == "input"))
        .ok_or("No video downloaded. Choose a public video under 12 hours.")?;
    let mut media = ingest(&app, &input, title, playable, &mut track).await?;
    media.source = Some(source.to_string());
    Ok(media)
}

pub fn valid_range(start: f64, end: f64, duration: f64) -> bool {
    start.is_finite()
        && end.is_finite()
        && start >= 0.
        && end <= duration + 0.001
        && end - start >= 0.249
}

/// Even pixel count, at least 2. Matches clip-ai `even`.
fn even(value: f64) -> u32 {
    ((value / 2.0).round().max(1.0) as u32) * 2
}

fn trunc_even(value: f64) -> u32 {
    ((value / 2.0).trunc() * 2.0).max(2.0) as u32
}

/// The center-crop frame for a shape, in source pixels. Same rounding as the fill `crop=` filter.
pub fn frame_size(shape: &str, width: u64, height: u64) -> Result<(u32, u32)> {
    let (iw, ih) = (width as f64, height as f64);
    match shape {
        "vertical" => Ok((
            trunc_even(iw.min(ih * 9.0 / 16.0)),
            trunc_even(ih.min(iw * 16.0 / 9.0)),
        )),
        "square" => {
            let side = trunc_even(iw.min(ih));
            Ok((side, side))
        }
        _ => Err("Unknown aspect ratio.".into()),
    }
}

/// `fill` keeps the existing center crop. `blur` is clip-ai `render_filters` with `fit == "blur"`:
/// the whole picture, scaled to fit, over a darkened blurred cover of the same frame.
pub fn clip_filter(shape: &str, fit: &str, width: u64, height: u64) -> Result<String> {
    if shape == "source" {
        return Ok("setsar=1".into());
    }
    if fit.is_empty() || fit == "fill" {
        return Ok(match shape {
            "vertical" => {
                "crop=w='trunc(min(iw,ih*9/16)/2)*2':h='trunc(min(ih,iw*16/9)/2)*2',setsar=1".into()
            }
            "square" => "crop='trunc(min(iw,ih)/2)*2':'trunc(min(iw,ih)/2)*2',setsar=1".into(),
            _ => return Err("Unknown aspect ratio.".into()),
        });
    }
    if fit != "blur" {
        return Err("Unknown fit.".into());
    }
    let (frame_w, frame_h) = frame_size(shape, width, height)?;
    let (small_w, small_h) = (even(frame_w as f64 / 4.0), even(frame_h as f64 / 4.0));
    Ok(format!(
        "split[bgsrc][fgsrc];[bgsrc]scale={small_w}:{small_h}:force_original_aspect_ratio=increase,crop={small_w}:{small_h},boxblur=10:2,scale={frame_w}:{frame_h},eq=brightness=-0.18[bg];[fgsrc]scale={frame_w}:{frame_h}:force_original_aspect_ratio=decrease:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1"
    ))
}

/// Clearer voice is clip-ai's `highpass=f=90`. Off leaves the audio filter untouched.
pub fn voice_filter(voice: bool) -> Option<&'static str> {
    if voice {
        Some("highpass=f=90")
    } else {
        None
    }
}

/// clip-ai `PAUSE_MIN`, `PAUSE_NOISE`, and `PAUSE_PAD`. A quiet stretch shorter than this stays.
const PAUSE_MIN: f64 = 0.5;
const PAUSE_PAD: f64 = 0.12;

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn number_after(line: &str, key: &str) -> Option<f64> {
    let rest = line.split_once(key)?.1;
    rest.split_whitespace().next()?.parse().ok()
}

/// silencedetect lines. An open silence runs to the end of the clip. Times are clip-relative.
pub fn parse_silences(log: &str, duration: f64) -> Vec<(f64, f64)> {
    let mut spans = Vec::new();
    let mut start: Option<f64> = None;
    for line in log.lines() {
        if let Some(value) = number_after(line, "silence_start:") {
            start = Some(value.max(0.0));
        } else if let Some(value) = number_after(line, "silence_end:") {
            if let Some(from) = start.take() {
                spans.push((from, value.min(duration)));
            }
        }
    }
    if let Some(from) = start {
        if from < duration {
            spans.push((from, duration));
        }
    }
    spans
}

/// What stays after each silence loses its padding (clip-ai `kept_ranges`).
/// A silence on the first or last frame is cut all the way to that edge.
pub fn kept_ranges(silences: &[(f64, f64)], duration: f64) -> Vec<(f64, f64)> {
    let mut ordered: Vec<(f64, f64)> = silences
        .iter()
        .copied()
        .filter(|(start, end)| start.is_finite() && end.is_finite() && end > start)
        .collect();
    ordered.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut kept = Vec::new();
    let mut at = 0.0;
    for (start, end) in ordered {
        let cut_start = if start <= 0.01 {
            0.0
        } else {
            start + PAUSE_PAD
        };
        let cut_end = if end >= duration - 0.01 {
            duration
        } else {
            end - PAUSE_PAD
        };
        if cut_end - cut_start < 0.2 || (cut_start <= at && at > 0.0) {
            continue;
        }
        kept.push((round3(at), round3(cut_start)));
        at = cut_end;
    }
    if duration - at > 0.05 {
        kept.push((round3(at), round3(duration)));
    }
    kept.retain(|(start, end)| end - start > 0.01);
    if kept.is_empty() {
        vec![(0.0, round3(duration))]
    } else {
        kept
    }
}

/// The cut is applied only when the spoken part is at least 0.3s shorter.
pub fn applied_keeps(silences: &[(f64, f64)], duration: f64) -> Option<Vec<(f64, f64)>> {
    if !(duration.is_finite() && duration > 0.0) {
        return None;
    }
    let kept = kept_ranges(silences, duration);
    let spoken: f64 = kept.iter().map(|(start, end)| end - start).sum();
    if spoken < duration - 0.3 {
        Some(kept)
    } else {
        None
    }
}

fn span_expr(kept: &[(f64, f64)]) -> String {
    kept.iter()
        .map(|(start, end)| format!("gte(t,{start:.3})*lt(t,{end:.3})"))
        .collect::<Vec<_>>()
        .join("+")
}

fn format_rate(rate: f64) -> String {
    let rate = if rate.is_finite() && rate > 0.0 {
        rate
    } else {
        30.0
    };
    let text = format!("{rate:.6}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text.is_empty() {
        "30".into()
    } else {
        text.to_string()
    }
}

/// clip-ai `keep_select` for video: constant frame rate, then close the gaps by frame count.
pub fn video_select(kept: &[(f64, f64)], rate: f64) -> String {
    format!(
        "fps={},select='{}',setpts=N/FRAME_RATE/TB",
        format_rate(rate),
        span_expr(kept)
    )
}

/// clip-ai `keep_select` for audio.
pub fn audio_select(kept: &[(f64, f64)]) -> String {
    format!("aselect='{}',asetpts=N/SR/TB", span_expr(kept))
}

/// The studio's four steps. Anything else, including a missing 1×, stays at 1 so an old export is unchanged.
fn clip_speed(speed: f64) -> f64 {
    for step in [1.1_f64, 1.25, 1.5] {
        if (speed - step).abs() < 1e-4 {
            return step;
        }
    }
    1.0
}

/// Python's `:g`: `1.5`, `1.1`, `1.25`, with no trailing zeros.
fn format_speed(speed: f64) -> String {
    let text = format!("{speed:.6}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text.is_empty() {
        "1".into()
    } else {
        text.to_string()
    }
}

/// clip-ai appends `setpts=PTS/{speed}` after the crop. Speed 1 leaves the filter text alone.
fn pace_video(filter: &str, speed: f64) -> String {
    let speed = clip_speed(speed);
    if speed == 1.0 {
        filter.to_string()
    } else {
        format!("{filter},setpts=PTS/{}", format_speed(speed))
    }
}

fn sound_chain(voice: bool, kept: Option<&[(f64, f64)]>, speed: f64) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(spans) = kept {
        parts.push(audio_select(spans));
    }
    let speed = clip_speed(speed);
    if speed != 1.0 {
        parts.push(format!("atempo={}", format_speed(speed)));
    }
    if let Some(filter) = voice_filter(voice) {
        parts.push(filter.to_string());
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(","))
    }
}

#[derive(Serialize)]
pub struct PauseCut {
    start: f64,
    end: f64,
}

#[derive(Serialize)]
pub struct PausePlan {
    cuts: Vec<PauseCut>,
    count: u32,
    seconds: f64,
}

fn empty_plan() -> PausePlan {
    PausePlan {
        cuts: Vec::new(),
        count: 0,
        seconds: 0.0,
    }
}

fn plan_for(kept: Option<&[(f64, f64)]>, duration: f64, origin: f64) -> PausePlan {
    let Some(spans) = kept else {
        return empty_plan();
    };
    let mut cuts = Vec::new();
    let mut cursor = 0.0;
    for (start, end) in spans {
        if start - cursor > 0.01 {
            cuts.push(PauseCut {
                start: round3(origin + cursor),
                end: round3(origin + start),
            });
        }
        cursor = *end;
    }
    if duration - cursor > 0.01 {
        cuts.push(PauseCut {
            start: round3(origin + cursor),
            end: round3(origin + duration),
        });
    }
    let spoken: f64 = spans.iter().map(|(start, end)| end - start).sum();
    PausePlan {
        count: cuts.len() as u32,
        seconds: round3((duration - spoken).max(0.0)),
        cuts,
    }
}

async fn detect_keeps(input: &Path, start: f64, duration: f64) -> Result<Option<Vec<(f64, f64)>>> {
    let start_text = format!("{start:.3}");
    let duration_text = format!("{duration:.3}");
    let silence = format!("silencedetect=noise=-35dB:d={PAUSE_MIN}");
    let path = text(input)?.to_string();
    let log = run_log(
        "ffmpeg",
        &[
            "-hide_banner",
            "-nostdin",
            "-ss",
            &start_text,
            "-t",
            &duration_text,
            "-protocol_whitelist",
            "file",
            "-i",
            &path,
            "-map",
            "0:a:0",
            "-vn",
            "-af",
            &silence,
            "-f",
            "null",
            "-",
        ],
        300,
    )
    .await?;
    Ok(applied_keeps(&parse_silences(&log, duration), duration))
}

pub async fn find_pauses(app: AppHandle, id: String, start: f64, end: f64) -> Result<PausePlan> {
    let input = source(&app, &id)?;
    let (duration, _, _, _, audio) = probe(&input).await?;
    if !valid_range(start, end, duration) {
        return Err("The cut must be inside the source and at least 0.25 seconds long.".into());
    }
    let length = end - start;
    if !audio {
        return Ok(empty_plan());
    }
    let keeps = detect_keeps(&input, start, length).await?;
    Ok(plan_for(keeps.as_deref(), length, start))
}

/// Overlay a headline plate on the fitted frame. The plate is scaled to the frame.
/// `stop` ends the overlay when the video ends, so a looped plate cannot hold the clip open.
pub fn with_plate(filter: &str, width: u32, height: u32, stop: bool) -> String {
    let tail = if stop { ":shortest=1" } else { "" };
    format!(
        "[0:v]{filter}[base];[1:v]scale={width}:{height},format=rgba[mark];[base][mark]overlay=0:0{tail},format=yuv420p[v]"
    )
}

fn gain(value: f64) -> String {
    let value = if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.2
    };
    let text = format!("{value:.4}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text.is_empty() {
        "0".into()
    } else {
        text.to_string()
    }
}

/// The clip's sound with music, from the video (input 0) and the track (`music_input`, read with `-stream_loop -1`)
/// to `[aout]`. Loudness is applied only on this mix, matching clip-ai `music_graph`.
pub fn music_graph(
    voice: Option<&str>,
    volume: f64,
    length: f64,
    music_input: usize,
    source_audio: bool,
) -> String {
    let fade_in = 0.5_f64.min(length / 2.0).max(0.0);
    let fade_out = 1.0_f64.min(length / 2.0).max(0.0);
    let mut track = format!(
        "atrim=start=0.000,asetpts=PTS-STARTPTS,atrim=duration={length:.3},aresample=48000,volume={}",
        gain(volume)
    );
    if fade_in > 0.0 {
        track.push_str(&format!(",afade=t=in:st=0:d={fade_in:.3}"));
    }
    if fade_out > 0.0 {
        let at = (length - fade_out).max(0.0);
        track.push_str(&format!(",afade=t=out:st={at:.3}:d={fade_out:.3}"));
    }
    let voice_src = if source_audio {
        match voice {
            Some(filter) => format!("[0:a]{filter},volume=1[voice]"),
            None => "[0:a]volume=1[voice]".to_string(),
        }
    } else {
        format!("anullsrc=r=48000:cl=stereo,atrim=duration={length:.3}[voice]")
    };
    format!(
        "{voice_src};[{music_input}:a]{track}[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]"
    )
}

fn audio_extension(path: &Path) -> Result<String> {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "mp3" | "wav" | "m4a" | "ogg" | "flac" | "aac") {
        return Err("Use an MP3, WAV, M4A, OGG, FLAC, or AAC file.".into());
    }
    Ok(ext)
}

fn accepted_music(path: &Path) -> Result<()> {
    audio_extension(path)?;
    let meta = path
        .metadata()
        .map_err(|_| "The music file is missing. Add it again.".to_string())?;
    if !meta.is_file() || meta.len() == 0 {
        return Err("That file has no sound we can read.".into());
    }
    if meta.len() > MAX_MUSIC_BYTES {
        return Err("Music files can be up to 20 MB.".into());
    }
    Ok(())
}

fn track_name(path: &Path) -> String {
    let stem = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let mut name = String::new();
    let mut gap = false;
    for c in stem.chars() {
        if c == '_' || c == '-' {
            gap = true;
            continue;
        }
        if gap && !name.is_empty() {
            name.push(' ');
        }
        gap = false;
        name.push(c);
    }
    let name: String = name.trim().chars().take(120).collect();
    if name.is_empty() {
        "Untitled track".into()
    } else {
        name
    }
}

#[derive(Serialize)]
pub struct MusicFile {
    path: String,
    name: String,
    duration: f64,
}

async fn probe_audio(path: &Path) -> Result<f64> {
    let bytes = run(
        "ffprobe",
        &[
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
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
    let data: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "That file has no sound we can read.".to_string())?;
    let streams = data["streams"]
        .as_array()
        .ok_or("That file has no sound we can read.")?;
    if !streams.iter().any(|s| s["codec_type"] == "audio") {
        return Err("That file has no sound we can read.".into());
    }
    let duration: f64 = data["format"]["duration"]
        .as_str()
        .unwrap_or("")
        .parse()
        .map_err(|_| "That file has no sound we can read.".to_string())?;
    if !duration.is_finite() || duration <= 0.0 {
        return Err("That file has no sound we can read.".into());
    }
    if duration > MAX_MUSIC_SECONDS {
        return Err("Tracks can be up to 20 minutes long.".into());
    }
    Ok(duration)
}

async fn owned_music(app: &AppHandle, path: &Path) -> Result<PathBuf> {
    let folder = fs::canonicalize(root(app)?.join("music"))
        .await
        .map_err(|_| "The music file is missing. Add it again.".to_string())?;
    let file = fs::canonicalize(path)
        .await
        .map_err(|_| "The music file is missing. Add it again.".to_string())?;
    if !file.starts_with(&folder) || file == folder {
        return Err("The music file is missing. Add it again.".into());
    }
    accepted_music(&file)?;
    Ok(file)
}

pub async fn pick_music(app: AppHandle) -> Result<Option<MusicFile>> {
    let dialog = app
        .dialog()
        .file()
        .add_filter("Audio", &["mp3", "wav", "m4a", "ogg", "flac", "aac"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let ext = audio_extension(&path)?;
    let meta = fs::metadata(&path)
        .await
        .map_err(|_| "The music file is missing. Add it again.".to_string())?;
    if !meta.is_file() || meta.len() == 0 {
        return Err("That file has no sound we can read.".into());
    }
    if meta.len() > MAX_MUSIC_BYTES {
        return Err("Music files can be up to 20 MB.".into());
    }
    let duration = probe_audio(&path).await?;
    let folder = root(&app)?.join("music");
    fs::create_dir_all(&folder)
        .await
        .map_err(|e| e.to_string())?;
    let dest = folder.join(format!("{}.{}", Uuid::new_v4(), ext));
    fs::copy(&path, &dest).await.map_err(|e| e.to_string())?;
    Ok(Some(MusicFile {
        path: dest
            .to_str()
            .ok_or("This file path cannot be represented as text.")?
            .to_string(),
        name: track_name(&path),
        duration,
    }))
}

/// Waveforms being drawn, by project id, so deleting a project can stop its ffmpeg first. Windows
/// will not delete a file another process has open.
static WAVES: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, tokio::sync::watch::Sender<bool>>>,
> = std::sync::LazyLock::new(Default::default);

/// Draws a project's waveform once the project is open. Reading the audio of a long source takes a
/// while (about 25 s an hour on a modest PC), and the editor is usable meanwhile. `None` when the
/// source has no audio.
pub async fn draw_wave(app: AppHandle, id: String) -> Result<Option<PathBuf>> {
    let uuid = Uuid::parse_str(&id)
        .map_err(|_| "Unknown project.")?
        .to_string();
    let folder = root(&app)?.join(&uuid);
    wave_into(&folder, &uuid).await
}

async fn wave_into(folder: &Path, key: &str) -> Result<Option<PathBuf>> {
    let video = folder.join("source.mp4");
    let wave = folder.join("wave.png");
    if wave.is_file() {
        return Ok(Some(wave));
    }
    let (duration, .., audio) = probe(&video).await?;
    if !audio {
        return Ok(None);
    }
    let part = folder.join("wave.part.png");
    let args = [
        "-v",
        "error",
        "-y",
        "-i",
        text(&video)?,
        "-filter_complex",
        "aresample=8000,showwavespic=s=1000x64:colors=0x94b5ba:scale=sqrt",
        "-frames:v",
        "1",
        text(&part)?,
    ];
    let (stop, mut stopped) = tokio::sync::watch::channel(false);
    {
        let mut waves = WAVES.lock().map_err(|_| "Waveform state unavailable.")?;
        if waves.contains_key(key) {
            return Err("The waveform is already being drawn.".into());
        }
        waves.insert(key.to_owned(), stop);
    }
    // About 5 s per half hour of audio here. Leave room for twelve hours on a slow disk.
    let drawing = run("ffmpeg", &args, (duration / 4.0).max(300.0) as u64);
    // Dropping `drawing` when stopped kills its ffmpeg.
    let drawn = tokio::select! {
        biased;
        _ = stopped.changed() => Err("Waveform stopped.".to_string()),
        drawn = drawing => drawn,
    };
    if let Ok(mut waves) = WAVES.lock() {
        waves.remove(key);
    }
    match drawn {
        Ok(_) => {
            fs::rename(&part, &wave).await.map_err(|e| e.to_string())?;
            Ok(Some(wave))
        }
        Err(e) => {
            let _ = fs::remove_file(&part).await;
            Err(e)
        }
    }
}

fn stop_wave(key: &str) {
    if let Some(stop) = WAVES.lock().ok().and_then(|mut waves| waves.remove(key)) {
        let _ = stop.send(true);
    }
}

/// Removes an imported project's folder: its editing copy, thumbnails, and waveform. The original
/// file and exports live elsewhere. Only a project id (a UUID) is accepted, so nothing outside the
/// media folder can be named.
pub async fn delete_media(app: AppHandle, id: String) -> Result<()> {
    let uuid = Uuid::parse_str(&id)
        .map_err(|_| "Unknown project.")?
        .to_string();
    stop_wave(&uuid);
    crate::transcript::stop_transcript(&uuid);
    remove_folder(&root(&app)?.join(uuid)).await
}

async fn remove_folder(folder: &Path) -> Result<()> {
    // On Windows the player can hold the editing copy open for a moment after it is closed.
    for attempt in 0..10 {
        match fs::remove_dir_all(folder).await {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) if attempt < 9 && e.kind() == std::io::ErrorKind::PermissionDenied => {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            Err(e) => {
                return Err(format!(
                    "Could not delete the project's files. Close anything using them and try again. ({e})"
                ))
            }
        }
    }
    Ok(())
}

pub async fn forget_music(app: AppHandle, path: String) -> Result<()> {
    let Ok(folder) = fs::canonicalize(root(&app)?.join("music")).await else {
        return Ok(());
    };
    let Ok(file) = fs::canonicalize(Path::new(&path)).await else {
        return Ok(());
    };
    if file.starts_with(&folder) && file != folder {
        let _ = fs::remove_file(file).await;
    }
    Ok(())
}

/// PNG width and height from the IHDR. Same limits as ClipCheap's brand logo.
pub fn png_size(bytes: &[u8]) -> Result<(u32, u32)> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return Err("Use a PNG logo, ideally with a transparent background.".into());
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    if width < MIN_LOGO_SIDE || height < MIN_LOGO_SIDE {
        return Err(format!(
            "Logos need at least {MIN_LOGO_SIDE} px on each side."
        ));
    }
    if width > MAX_LOGO_SIDE || height > MAX_LOGO_SIDE {
        return Err(format!(
            "Logos can be up to {MAX_LOGO_SIDE} px on each side."
        ));
    }
    Ok((width, height))
}

pub struct LogoBox {
    pub box_width: u32,
    pub box_height: u32,
    pub margin: u32,
    pub top: u32,
    pub bottom: u32,
    pub x: String,
    pub y: String,
}

/// clip-ai `logo_place`. The box is even. `x` and `y` are ffmpeg overlay expressions.
pub fn logo_place(width: u32, height: u32, corner: &str) -> Result<LogoBox> {
    if !matches!(
        corner,
        "top-left" | "top-right" | "bottom-left" | "bottom-right"
    ) {
        return Err("Choose a corner for the logo.".into());
    }
    let short = width.min(height) as f64;
    let box_width = even(short * 0.2);
    let box_height = even(short * 0.1);
    let margin = (short * 0.04).round() as u32;
    let vertical = height > width;
    let top = if vertical {
        (height as f64 * 0.09).round() as u32
    } else {
        margin
    };
    let bottom = if vertical {
        (height as f64 * 0.2).round() as u32
    } else {
        margin
    };
    let x = if corner.ends_with("left") {
        margin.to_string()
    } else {
        format!("W-w-{margin}")
    };
    let y = if corner.starts_with("top") {
        top.to_string()
    } else {
        format!("H-h-{bottom}")
    };
    Ok(LogoBox {
        box_width,
        box_height,
        margin,
        top,
        bottom,
        x,
        y,
    })
}

pub struct LogoFit {
    pub width: u32,
    pub height: u32,
    pub x: u32,
    pub y: u32,
}

/// The fitted image inside `logo_place`'s box, in frame pixels. Matches `logoFit` in logo.ts.
pub fn logo_fit(
    frame_w: u32,
    frame_h: u32,
    logo_w: u32,
    logo_h: u32,
    corner: &str,
) -> Result<LogoFit> {
    if logo_w == 0 || logo_h == 0 {
        return Err("Use a PNG logo, ideally with a transparent background.".into());
    }
    let place = logo_place(frame_w, frame_h, corner)?;
    let scale =
        (place.box_width as f64 / logo_w as f64).min(place.box_height as f64 / logo_h as f64);
    let mut width = (logo_w as f64 * scale).round().max(1.0) as u32;
    let mut height = (logo_h as f64 * scale).round().max(1.0) as u32;
    if width > place.box_width {
        width = place.box_width;
    }
    if height > place.box_height {
        height = place.box_height;
    }
    let x = if corner.ends_with("left") {
        place.margin
    } else {
        frame_w.saturating_sub(width).saturating_sub(place.margin)
    };
    let y = if corner.starts_with("top") {
        place.top
    } else {
        frame_h.saturating_sub(height).saturating_sub(place.bottom)
    };
    Ok(LogoFit {
        width,
        height,
        x,
        y,
    })
}

/// The picture graph with a logo on input `logo_input`. A plate, when present, is input 1.
/// `stop` ends each overlay with the video so a looped PNG cannot hold a shortened clip open.
pub fn logo_graph(
    filter: &str,
    frame_w: u32,
    frame_h: u32,
    corner: &str,
    logo_input: usize,
    plate: bool,
    stop: bool,
) -> Result<String> {
    let place = logo_place(frame_w, frame_h, corner)?;
    let tail = if stop { ":shortest=1" } else { "" };
    let brand = format!(
        "[{logo_input}:v]scale={}:{}:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba[brand]",
        place.box_width, place.box_height
    );
    let overlay = format!("overlay={}:{}{tail}", place.x, place.y);
    if plate {
        Ok(format!(
            "[0:v]{filter}[base];[1:v]scale={frame_w}:{frame_h},format=rgba[mark];[base][mark]overlay=0:0{tail}[plated];{brand};[plated][brand]{overlay},format=yuv420p[v]"
        ))
    } else {
        Ok(format!(
            "[0:v]{filter}[base];{brand};[base][brand]{overlay},format=yuv420p[v]"
        ))
    }
}

fn logo_name(path: &Path) -> String {
    let name = track_name(path);
    if name == "Untitled track" {
        "Untitled logo".into()
    } else {
        name
    }
}

async fn read_logo(path: &Path) -> Result<(u32, u32)> {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext != "png" {
        return Err("Use a PNG logo, ideally with a transparent background.".into());
    }
    let meta = fs::metadata(path)
        .await
        .map_err(|_| "The logo file is missing. Add it again.".to_string())?;
    if !meta.is_file() || meta.len() == 0 {
        return Err("Choose a PNG logo to upload.".into());
    }
    if meta.len() > MAX_LOGO_BYTES {
        return Err("Logos can be up to 2 MB.".into());
    }
    let bytes = fs::read(path).await.map_err(|e| e.to_string())?;
    png_size(&bytes)
}

async fn owned_logo(app: &AppHandle, path: &Path) -> Result<PathBuf> {
    let folder = fs::canonicalize(root(app)?.join("logos"))
        .await
        .map_err(|_| "The logo file is missing. Add it again.".to_string())?;
    let file = fs::canonicalize(path)
        .await
        .map_err(|_| "The logo file is missing. Add it again.".to_string())?;
    if !file.starts_with(&folder) || file == folder {
        return Err("The logo file is missing. Add it again.".into());
    }
    read_logo(&file).await?;
    Ok(file)
}

#[derive(Serialize)]
pub struct LogoFile {
    path: String,
    name: String,
    width: u32,
    height: u32,
}

pub async fn pick_logo(app: AppHandle) -> Result<Option<LogoFile>> {
    let dialog = app.dialog().file().add_filter("PNG", &["png"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let (width, height) = read_logo(&path).await?;
    let folder = root(&app)?.join("logos");
    fs::create_dir_all(&folder)
        .await
        .map_err(|e| e.to_string())?;
    let dest = folder.join(format!("{}.png", Uuid::new_v4()));
    fs::copy(&path, &dest).await.map_err(|e| e.to_string())?;
    Ok(Some(LogoFile {
        path: dest
            .to_str()
            .ok_or("This file path cannot be represented as text.")?
            .to_string(),
        name: logo_name(&path),
        width,
        height,
    }))
}

pub async fn forget_logo(app: AppHandle, path: String) -> Result<()> {
    let Ok(folder) = fs::canonicalize(root(&app)?.join("logos")).await else {
        return Ok(());
    };
    let Ok(file) = fs::canonicalize(Path::new(&path)).await else {
        return Ok(());
    };
    if file.starts_with(&folder) && file != folder {
        let _ = fs::remove_file(file).await;
    }
    Ok(())
}

fn output_frame(shape: &str, width: u64, height: u64) -> Result<(u32, u32)> {
    if shape == "source" {
        return Ok((width.max(2) as u32, height.max(2) as u32));
    }
    frame_size(shape, width, height)
}

fn decode_plate(png: &str) -> Result<Vec<u8>> {
    let bytes = STANDARD
        .decode(png.trim())
        .map_err(|_| "The headline image is not a PNG.".to_string())?;
    if bytes.len() < 8 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("The headline image is not a PNG.".into());
    }
    if bytes.len() > 8_000_000 {
        return Err("The headline image is too large.".into());
    }
    Ok(bytes)
}

pub async fn export_clip(
    app: AppHandle,
    id: String,
    title: String,
    start: f64,
    end: f64,
    shape: String,
    fit: String,
    headline: String,
    voice: bool,
    music: String,
    volume: f64,
    pauses: bool,
    logo: String,
    corner: String,
    speed: f64,
    captions: String,
) -> Result<Option<String>> {
    // Checked before the save dialog, so a bad request never leaves the user choosing a file for nothing.
    let captions = crate::captions::parse(&captions)?;
    let input = source(&app, &id)?;
    let (duration, width, height, fps, source_audio) = probe(&input).await?;
    if !valid_range(start, end, duration) {
        return Err("The cut must be inside the source and at least 0.25 seconds long.".into());
    }
    let filter = clip_filter(&shape, &fit, width, height)?;
    let plate = if headline.is_empty() {
        None
    } else {
        Some(decode_plate(&headline)?)
    };
    let (frame_w, frame_h) = output_frame(&shape, width, height)?;
    let corner = corner.trim();
    if !logo.trim().is_empty() {
        logo_place(frame_w, frame_h, corner)?;
    }
    let stem = file_stem(&title);
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
    let music_file = if music.trim().is_empty() {
        None
    } else {
        Some(owned_music(&app, Path::new(music.trim())).await?)
    };
    let logo_file = if logo.trim().is_empty() {
        None
    } else {
        Some(owned_logo(&app, Path::new(logo.trim())).await?)
    };
    let plate_path = if let Some(bytes) = plate {
        let mut file = tempfile::Builder::new()
            .suffix(".png")
            .tempfile_in(target.parent().ok_or("Invalid destination.")?)
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        Some(file.into_temp_path())
    } else {
        None
    };
    let keeps = if pauses && source_audio {
        detect_keeps(&input, start, end - start).await?
    } else {
        None
    };
    let scripts = captions.as_ref().map(|captions| {
        caption_script(
            captions,
            end - start,
            keeps.as_deref(),
            speed,
            frame_w,
            frame_h,
        )
    });
    let caption_folder = match &scripts {
        Some((ass, _)) => Some(
            caption_folder(
                &app.path()
                    .resource_dir()
                    .map_err(|e| e.to_string())?
                    .join("fonts"),
                ass,
            )
            .await?,
        ),
        None => None,
    };
    render_captioned(
        &input,
        &target,
        start,
        end,
        &filter,
        voice,
        plate_path.as_deref(),
        frame_w,
        frame_h,
        music_file.as_deref(),
        volume,
        source_audio,
        keeps.as_deref(),
        fps,
        logo_file.as_deref(),
        corner,
        speed,
        caption_folder.as_ref().map(|dir| dir.path()),
    )
    .await?;
    // The captions as SubRip beside the clip, timed as burned in, for platforms that take a captions file
    // (clip-ai uploads one with every render).
    if let Some((_, srt)) = &scripts {
        fs::write(target.with_extension("srt"), srt)
            .await
            .map_err(|e| format!("The clip was saved, but its captions file was not: {e}"))?;
    }
    Ok(Some(target.to_string_lossy().into_owned()))
}

/// A safe file name from a title: letters, digits and dashes, the rest as underscores.
fn file_stem(title: &str) -> String {
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
    if stem.trim_matches('_').is_empty() {
        "quikclip".into()
    } else {
        stem
    }
}

/// Text the studio made (a transcript, subtitles) saved where the user chooses.
pub async fn save_text(
    app: AppHandle,
    name: String,
    extension: String,
    contents: String,
) -> Result<Option<String>> {
    let (kind, ext) = match extension.as_str() {
        "txt" => ("Text", "txt"),
        "srt" => ("SubRip subtitles", "srt"),
        _ => return Err("Unsupported file type.".into()),
    };
    if contents.len() > 64 * 1024 * 1024 {
        return Err("That file is too large to save.".into());
    }
    let dialog = app
        .dialog()
        .file()
        .add_filter(kind, &[ext])
        .set_file_name(format!("{}.{ext}", file_stem(&name)));
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let mut target = picked.into_path().map_err(|e| e.to_string())?;
    if !target
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case(ext))
    {
        target.set_extension(ext);
    }
    if target.starts_with(root(&app)?) {
        return Err("Choose a place outside your source library.".into());
    }
    fs::write(&target, contents)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

/// The clip's captions as drawn (clip-ai pipeline.render): moved onto the clip once its pauses are gone, onto the sped
/// clock, paced over the clip's final length, and set for its frame.
fn caption_script(
    captions: &crate::captions::Captions,
    span: f64,
    kept: Option<&[(f64, f64)]>,
    speed: f64,
    width: u32,
    height: u32,
) -> (String, String) {
    let speed = clip_speed(speed);
    let spoken: f64 = kept.map_or(span, |spans| spans.iter().map(|(a, b)| b - a).sum());
    let cues = match kept {
        Some(spans) => crate::captions::remap_cues(&captions.cues, spans),
        None => captions.cues.clone(),
    };
    let cues = crate::captions::speed_cues(&cues, speed);
    let shown = crate::captions::pace_cues(&cues, Some(spoken / speed));
    (
        crate::captions::to_ass(&shown, width, height, captions),
        crate::captions::to_srt(&shown),
    )
}

/// A folder holding `captions.ass` and the caption font: ffmpeg runs in it, so the `ass` filter names both relatively.
async fn caption_folder(fonts: &Path, script: &str) -> Result<tempfile::TempDir> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    fs::create_dir(dir.path().join("fonts"))
        .await
        .map_err(|e| e.to_string())?;
    for name in crate::captions::FONT_FILES {
        fs::copy(fonts.join(name), dir.path().join("fonts").join(name))
            .await
            .map_err(|_| "The caption font is missing. Reinstall Quikclip to restore it.")?;
    }
    fs::write(dir.path().join("captions.ass"), script)
        .await
        .map_err(|e| e.to_string())?;
    Ok(dir)
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
async fn render(
    input: &Path,
    target: &Path,
    start: f64,
    end: f64,
    filter: &str,
    voice: bool,
    plate: Option<&Path>,
    frame_w: u32,
    frame_h: u32,
    music: Option<&Path>,
    volume: f64,
    source_audio: bool,
    kept: Option<&[(f64, f64)]>,
    rate: f64,
    logo: Option<&Path>,
    corner: &str,
    speed: f64,
) -> Result<()> {
    render_captioned(
        input,
        target,
        start,
        end,
        filter,
        voice,
        plate,
        frame_w,
        frame_h,
        music,
        volume,
        source_audio,
        kept,
        rate,
        logo,
        corner,
        speed,
        None,
    )
    .await
}

/// `captions`: a `caption_folder`; ffmpeg runs in it and burns its captions in after the speed change, under the
/// headline plate and the logo, as clip-ai's render_filters orders them.
#[allow(clippy::too_many_arguments)]
async fn render_captioned(
    input: &Path,
    target: &Path,
    start: f64,
    end: f64,
    filter: &str,
    voice: bool,
    plate: Option<&Path>,
    frame_w: u32,
    frame_h: u32,
    music: Option<&Path>,
    volume: f64,
    source_audio: bool,
    kept: Option<&[(f64, f64)]>,
    rate: f64,
    logo: Option<&Path>,
    corner: &str,
    speed: f64,
    captions: Option<&Path>,
) -> Result<()> {
    let temp = tempfile::Builder::new()
        .suffix(".mp4")
        .tempfile_in(target.parent().ok_or("Invalid destination.")?)
        .map_err(|e| e.to_string())?
        .into_temp_path();
    let speed = clip_speed(speed);
    let span = end - start;
    let spoken = match kept {
        Some(spans) => spans.iter().map(|(start, end)| end - start).sum(),
        None => span,
    };
    // Music and the output cap use the sped clock. Speed 1 keeps `spoken`, so the old graph text stays.
    let paced = if speed == 1.0 { spoken } else { spoken / speed };
    let duration = span.to_string();
    // A looped plate or music track would otherwise hold the file open until this cap.
    let written = if kept.is_some() || speed != 1.0 {
        (paced + 0.05).to_string()
    } else {
        duration.clone()
    };
    let start = start.to_string();
    let input = text(input)?;
    let destination = text(&temp)?;
    let plate_arg = plate.map(text).transpose()?;
    let logo_arg = logo.map(text).transpose()?;
    let music_arg = music.map(text).transpose()?;
    let mut picture_filter = pace_video(
        &match kept {
            Some(spans) => format!("{},{filter}", video_select(spans, rate)),
            None => filter.to_string(),
        },
        speed,
    );
    if captions.is_some() {
        picture_filter.push_str(",ass=captions.ass:fontsdir=fonts");
    }
    let sound = sound_chain(voice, kept, speed);
    let logo_on = logo.is_some();
    // No logo keeps the previous picture graph, including the plain `-vf` path.
    let picture = if logo_on {
        logo_graph(
            &picture_filter,
            frame_w,
            frame_h,
            corner,
            1 + usize::from(plate.is_some()),
            plate.is_some(),
            kept.is_some(),
        )?
    } else if plate.is_some() {
        with_plate(&picture_filter, frame_w, frame_h, kept.is_some())
    } else {
        format!("[0:v]{picture_filter}[v]")
    };
    let music_input = 1 + usize::from(plate.is_some()) + usize::from(logo_on);
    let mixed = music.is_some().then(|| {
        let audio = music_graph(sound.as_deref(), volume, paced, music_input, source_audio);
        format!("{picture};{audio}")
    });
    let mut args = vec!["-v", "error", "-nostdin", "-y", "-ss", &start];
    // Read only the cut when pauses close gaps or the clip plays faster. A dropped frame would
    // not advance the output clock, and a sped clip would otherwise run past its out point.
    // Speed 1 with no pauses keeps the old argv.
    if kept.is_some() || speed != 1.0 {
        args.extend(["-t", &duration]);
    }
    args.extend(["-i", input]);
    if let Some(path) = plate_arg {
        args.extend(["-loop", "1", "-i", path]);
    }
    if let Some(path) = logo_arg {
        args.extend(["-loop", "1", "-i", path]);
    }
    if let Some(path) = music_arg {
        args.extend([
            "-stream_loop",
            "-1",
            "-protocol_whitelist",
            "file",
            "-i",
            path,
        ]);
    }
    args.extend(["-t", &written]);
    if let Some(graph) = mixed.as_deref() {
        args.extend(["-filter_complex", graph, "-map", "[v]", "-map", "[aout]"]);
    } else if plate.is_some() || logo_on {
        args.extend(["-filter_complex", &picture, "-map", "[v]"]);
        args.extend(["-map", "0:a:0?"]);
        if let Some(audio) = sound.as_deref() {
            args.extend(["-af", audio]);
        }
    } else {
        args.extend(["-map", "0:v:0", "-vf", picture_filter.as_str()]);
        args.extend(["-map", "0:a:0?"]);
        if let Some(audio) = sound.as_deref() {
            args.extend(["-af", audio]);
        }
    }
    args.extend([
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
        &destination,
    ]);
    run_in(captions, "ffmpeg", &args, 7200).await?;
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
        render(
            &sample,
            &output,
            2.,
            3.5,
            "crop=360:640,setsar=1",
            false,
            None,
            360,
            640,
            None,
            0.2,
            true,
            None,
            24.,
            None,
            "",
            1.0,
        )
        .await
        .unwrap();
        let (duration, w, h, _, audio) = probe(&output).await.unwrap();
        assert!((duration - 1.5).abs() < 0.1);
        assert_eq!((w, h, audio), (360, 640, true));
        let (source_duration, width, height, _, _) = probe(&sample).await.unwrap();
        assert!(source_duration > 3.5);
        let blur = clip_filter("vertical", "blur", width, height).unwrap();
        assert!(blur.contains("boxblur=10:2"));
        assert!(blur.contains("eq=brightness=-0.18"));
        let blurred = tmp.path().join("blur.mp4");
        render(
            &sample, &blurred, 2., 3.5, &blur, false, None, 360, 640, None, 0.2, true, None, 24.,
            None, "", 1.0,
        )
        .await
        .unwrap();
        let (blur_duration, blur_w, blur_h, _, blur_audio) = probe(&blurred).await.unwrap();
        assert!((blur_duration - 1.5).abs() < 0.1);
        assert_eq!((blur_w, blur_h, blur_audio), (w, h, true));
        let imported = ingest_into(
            &tmp.path().join("library"),
            &output,
            "Portrait clip".into(),
            Playable::default(),
            &mut Tracker::new(IMPORT_STEPS.to_vec(), |_| {}),
        )
        .await
        .unwrap();
        assert!(imported.path.is_file());
        assert_eq!(imported.frames.len(), FRAME_COUNT);
        assert!(imported.frames.iter().all(|p| p.is_file()));
        assert!(imported.wave.is_none());
        let folder = imported.path.parent().unwrap();
        let wave = wave_into(folder, "portrait").await.unwrap().unwrap();
        assert!(wave.is_file());
        assert_eq!(wave_into(folder, "portrait").await.unwrap(), Some(wave));
    }
    #[test]
    fn fill_stays_a_center_crop_and_blur_uses_the_same_frame() {
        let fill = clip_filter("vertical", "fill", 1280, 640).unwrap();
        assert_eq!(
            fill,
            "crop=w='trunc(min(iw,ih*9/16)/2)*2':h='trunc(min(ih,iw*16/9)/2)*2',setsar=1"
        );
        assert_eq!(frame_size("vertical", 1280, 640).unwrap(), (360, 640));
        assert_eq!(frame_size("square", 1280, 640).unwrap(), (640, 640));
        assert_eq!(
            clip_filter("source", "blur", 1280, 640).unwrap(),
            "setsar=1"
        );
        assert!(clip_filter("vertical", "pan", 1280, 640).is_err());
        assert_eq!(voice_filter(false), None);
        assert_eq!(voice_filter(true), Some("highpass=f=90"));
        assert!(with_plate("setsar=1", 360, 640, false).contains("scale=360:640"));
        assert!(decode_plate("not-a-png").is_err());
    }
    #[tokio::test]
    async fn clearer_voice_and_a_headline_plate_stay_playable() {
        let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/sample/alpine.mp4");
        let tmp = tempfile::tempdir().unwrap();
        let plate = decode_plate(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        )
        .unwrap();
        let png = tmp.path().join("headline.png");
        std::fs::write(&png, plate).unwrap();
        let output = tmp.path().join("voiced.mp4");
        render(
            &sample,
            &output,
            2.,
            3.5,
            "crop=360:640,setsar=1",
            true,
            Some(&png),
            360,
            640,
            None,
            0.2,
            true,
            None,
            24.,
            None,
            "",
            1.0,
        )
        .await
        .unwrap();
        let (duration, w, h, _, audio) = probe(&output).await.unwrap();
        assert!((duration - 1.5).abs() < 0.1);
        assert_eq!((w, h, audio), (360, 640, true));
    }
    #[test]
    fn music_mixes_under_the_clip_on_its_clock() {
        let short = music_graph(None, 0.2, 1.2, 1, true);
        assert_eq!(
            short,
            "[0:a]volume=1[voice];[1:a]atrim=start=0.000,asetpts=PTS-STARTPTS,atrim=duration=1.200,aresample=48000,volume=0.2,afade=t=in:st=0:d=0.500,afade=t=out:st=0.600:d=0.600[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]"
        );
        let voiced = music_graph(Some("highpass=f=90"), 0.2, 20.0, 2, true);
        assert_eq!(
            voiced,
            "[0:a]highpass=f=90,volume=1[voice];[2:a]atrim=start=0.000,asetpts=PTS-STARTPTS,atrim=duration=20.000,aresample=48000,volume=0.2,afade=t=in:st=0:d=0.500,afade=t=out:st=19.000:d=1.000[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]"
        );
        let silent = music_graph(Some("highpass=f=90"), 0.2, 1.2, 1, false);
        assert!(silent.starts_with("anullsrc=r=48000:cl=stereo,atrim=duration=1.200[voice]"));
        assert!(!silent.contains("highpass"));
        assert_eq!(track_name(Path::new("my_cool-track.mp3")), "my cool track");
        assert_eq!(track_name(Path::new("bed.wav")), "bed");
        let tmp = tempfile::tempdir().unwrap();
        let notes = tmp.path().join("notes.txt");
        std::fs::write(&notes, b"hello").unwrap();
        assert!(accepted_music(&notes).is_err());
        let empty = tmp.path().join("empty.mp3");
        std::fs::write(&empty, b"").unwrap();
        assert!(accepted_music(&empty).is_err());
        let wav = tmp.path().join("bed.wav");
        std::fs::write(&wav, b"RIFF").unwrap();
        assert!(accepted_music(&wav).is_ok());
    }
    #[tokio::test]
    async fn music_under_a_headline_stays_playable() {
        let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/sample/alpine.mp4");
        let tmp = tempfile::tempdir().unwrap();
        let plate = decode_plate(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        )
        .unwrap();
        let png = tmp.path().join("headline.png");
        std::fs::write(&png, plate).unwrap();
        let mixed = tmp.path().join("mixed.mp4");
        render(
            &sample,
            &mixed,
            2.,
            3.5,
            "crop=360:640,setsar=1",
            true,
            Some(&png),
            360,
            640,
            Some(&sample),
            0.2,
            true,
            None,
            24.,
            None,
            "",
            1.0,
        )
        .await
        .unwrap();
        let (duration, w, h, _, audio) = probe(&mixed).await.unwrap();
        assert!((duration - 1.5).abs() < 0.1);
        assert_eq!((w, h, audio), (360, 640, true));
        let plain = tmp.path().join("music.mp4");
        render(
            &sample,
            &plain,
            2.,
            3.5,
            "setsar=1",
            false,
            None,
            1280,
            640,
            Some(&sample),
            0.2,
            true,
            None,
            24.,
            None,
            "",
            1.0,
        )
        .await
        .unwrap();
        let (plain_duration, plain_w, plain_h, _, plain_audio) = probe(&plain).await.unwrap();
        assert!((plain_duration - 1.5).abs() < 0.1);
        assert_eq!((plain_w, plain_h, plain_audio), (1280, 640, true));
    }
    #[test]
    fn canonical_video_urls_only() {
        fn expect(input: &str, url: &str, source: &str) {
            assert_eq!(video_link(input).unwrap(), (url.to_string(), source));
        }
        let youtube = "https://www.youtube.com/watch?v=abc_DEF-123";
        expect("https://youtu.be/abc_DEF-123?t=9", youtube, "YouTube");
        expect(
            "https://m.youtube.com/shorts/abc_DEF-123",
            youtube,
            "YouTube",
        );
        expect(
            "https://youtube.com/watch?v=abc_DEF-123&list=PL123",
            youtube,
            "YouTube",
        );
        expect(
            "https://www.twitch.tv/videos/6528877",
            "https://www.twitch.tv/videos/6528877",
            "Twitch",
        );
        expect(
            "https://twitch.tv/videos/6528877/",
            "https://www.twitch.tv/videos/6528877",
            "Twitch",
        );
        expect(
            "http://www.twitch.tv/riotgames/v/6528877?t=5m10s",
            "https://www.twitch.tv/videos/6528877",
            "Twitch",
        );
        expect(
            "https://m.twitch.tv/beagsandjam/v/247478721",
            "https://www.twitch.tv/videos/247478721",
            "Twitch",
        );
        expect(
            "https://www.twitch.tv/northernlion/video/291940395",
            "https://www.twitch.tv/videos/291940395",
            "Twitch",
        );
        expect(
            "https://player.twitch.tv/?video=480452374",
            "https://www.twitch.tv/videos/480452374",
            "Twitch",
        );
        expect(
            "https://player.twitch.tv/?t=5m10s&video=v6528877",
            "https://www.twitch.tv/videos/6528877",
            "Twitch",
        );
        expect(
            "https://www.twitch.tv/tangotek/schedule?vodID=1822395420",
            "https://www.twitch.tv/videos/1822395420",
            "Twitch",
        );
        expect(
            "https://clips.twitch.tv/FaintLightGullWholeWheat",
            "https://clips.twitch.tv/FaintLightGullWholeWheat",
            "Twitch",
        );
        expect(
            "https://www.twitch.tv/xqc/clip/CulturedAmazingKuduDatSheffy-TiZ_-ixAGYR3y2Uy",
            "https://clips.twitch.tv/CulturedAmazingKuduDatSheffy-TiZ_-ixAGYR3y2Uy",
            "Twitch",
        );
        expect(
            "https://clips.twitch.tv/rflegendary/UninterestedBeeDAESuppy",
            "https://clips.twitch.tv/UninterestedBeeDAESuppy",
            "Twitch",
        );
        expect(
            "https://clips.twitch.tv/embed?clip=InquisitiveBreakableYogurtJebaited&parent=localhost",
            "https://clips.twitch.tv/InquisitiveBreakableYogurtJebaited",
            "Twitch",
        );
        expect(
            "https://m.twitch.tv/rossbroadcast/clip/ConfidentBraveHumanChefFrank",
            "https://clips.twitch.tv/ConfidentBraveHumanChefFrank",
            "Twitch",
        );
        expect(
            "https://go.twitch.tv/rossbroadcast/clip/ConfidentBraveHumanChefFrank",
            "https://clips.twitch.tv/ConfidentBraveHumanChefFrank",
            "Twitch",
        );
        expect(
            "HTTPS://M.TWITCH.TV/clip/FaintLightGullWholeWheat",
            "https://clips.twitch.tv/FaintLightGullWholeWheat",
            "Twitch",
        );
        expect(
            "https://kick.com/xqc/videos/8dd97a8d-e17f-48fb-8bc3-565f88dbc9ea",
            "https://kick.com/xqc/videos/8dd97a8d-e17f-48fb-8bc3-565f88dbc9ea",
            "Kick",
        );
        expect(
            "https://www.kick.com/xqc/videos/01A0251F-EF48-702D-9289-D66922DA0E84?t=1",
            "https://kick.com/xqc/videos/01a0251f-ef48-702d-9289-d66922da0e84",
            "Kick",
        );
        expect(
            "https://kick.com/a-log-burner/videos/01a02882-5428-7ea1-9237-97f070aab4cc",
            "https://kick.com/a-log-burner/videos/01a02882-5428-7ea1-9237-97f070aab4cc",
            "Kick",
        );
        expect(
            "https://kick.com/mxddy?clip=clip_01GYXVB5Y8PWAPWCWMSBCFB05X",
            "https://kick.com/mxddy/clips/clip_01GYXVB5Y8PWAPWCWMSBCFB05X",
            "Kick",
        );
        expect(
            "https://kick.com/mxddy/?foo=1&clip=clip_01GYXVB5Y8PWAPWCWMSBCFB05X",
            "https://kick.com/mxddy/clips/clip_01GYXVB5Y8PWAPWCWMSBCFB05X",
            "Kick",
        );
        expect(
            "https://www.kick.com/spreen/clips/clip_01J8RGZRKHXHXXKJEHGRM932A5",
            "https://kick.com/spreen/clips/clip_01J8RGZRKHXHXXKJEHGRM932A5",
            "Kick",
        );
        for invalid in [
            "https://youtube.com.evil.test/watch?v=abc_DEF-123",
            "file:///movie",
            "https://youtube.com/playlist?list=abc",
            "https://youtu.be/abc/DEF-123",
            "https://user@youtu.be/abc_DEF-123",
            "https://www.twitch.tv/xqc",
            "https://www.twitch.tv/xqc/videos",
            "https://www.twitch.tv/xqc/profile",
            "https://www.twitch.tv/xqc/clips",
            "https://www.twitch.tv/collections/abc123",
            "https://twitch.tv.evil.test/videos/6528877",
            "https://user@www.twitch.tv/videos/6528877",
            "https://www.twitch.tv:8443/videos/6528877",
            "https://player.twitch.tv/popout?video=6528877",
            "https://clips.twitch.tv/embed",
            "https://www.twitch.tv/videos/not-a-vod",
            "https://www.twitch.tv/videos/6528877/chat",
            "https://kick.com/xqc",
            "https://kick.com/xqc/videos",
            "https://kick.com/xqc/videos/",
            "https://kick.com/xqc/clips",
            "https://kick.com/xqc/clips/",
            "https://kick.com/categories",
            "https://kick.com/search",
            "https://kick.com/auth",
            "https://kick.com/video/8dd97a8d-e17f-48fb-8bc3-565f88dbc9ea",
            "https://kick.com.evil/xqc/videos/8dd97a8d-e17f-48fb-8bc3-565f88dbc9ea",
            "https://user:pass@kick.com/xqc/videos/8dd97a8d-e17f-48fb-8bc3-565f88dbc9ea",
            "https://kick.com/xqc/videos/not-a-uuid",
            "https://kick.com/xqc/clips/notaclip",
            "https://kick.com/mxddy?clip=nope",
            "https://kick.com/xqc/clips/clip_01J8RGZRKHXHXXKJEHGRM932A5/extra",
            "https://example.com/watch?v=abc_DEF-123",
        ] {
            assert!(video_link(invalid).is_err(), "{invalid}");
        }
        assert_eq!(
            video_link("https://youtube.com/playlist?list=abc").unwrap_err(),
            "Enter a YouTube video, Shorts, or youtu.be link."
        );
        assert_eq!(
            video_link("https://user@youtu.be/abc_DEF-123").unwrap_err(),
            "Enter a YouTube video, Shorts, or youtu.be link."
        );
        assert_eq!(
            video_link("https://www.twitch.tv/xqc").unwrap_err(),
            "Enter a Twitch VOD or clip link."
        );
        assert_eq!(
            video_link("https://kick.com/xqc").unwrap_err(),
            "Enter a Kick video or clip link."
        );
        assert_eq!(
            video_link("https://example.com/watch?v=abc_DEF-123").unwrap_err(),
            "Enter a YouTube, Twitch, or Kick link."
        );
    }
    #[tokio::test]
    async fn a_waveform_is_drawn_later_and_stops_when_its_project_is_deleted() {
        let tmp = tempfile::tempdir().unwrap();
        let silent = tmp.path().join("silent");
        let loud = tmp.path().join("loud");
        for dir in [&silent, &loud] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let make = |dir: &Path, audio: bool, seconds: &str| {
            let mut args = vec![
                "-v".to_string(),
                "error".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                format!("color=c=black:s=160x90:r=10:d={seconds}"),
            ];
            if audio {
                args.extend([
                    "-f".into(),
                    "lavfi".into(),
                    "-i".into(),
                    format!("sine=f=300:r=48000:d={seconds}"),
                    "-c:a".into(),
                    "aac".into(),
                ]);
            }
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                dir.join("source.mp4").to_string_lossy().into_owned(),
            ]);
            args
        };
        let args = make(&silent, false, "1");
        run(
            "ffmpeg",
            &args.iter().map(String::as_str).collect::<Vec<_>>(),
            60,
        )
        .await
        .unwrap();
        assert_eq!(wave_into(&silent, "silent").await.unwrap(), None);
        // Long enough that the drawing is still running when the project is deleted.
        let args = make(&loud, true, "120");
        run(
            "ffmpeg",
            &args.iter().map(String::as_str).collect::<Vec<_>>(),
            300,
        )
        .await
        .unwrap();
        let drawing = tokio::spawn({
            let loud = loud.clone();
            async move { wave_into(&loud, "loud").await }
        });
        while !WAVES.lock().unwrap().contains_key("loud") {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        stop_wave("loud");
        assert_eq!(drawing.await.unwrap(), Err("Waveform stopped.".to_string()));
        assert!(!loud.join("wave.png").exists());
        assert!(!loud.join("wave.part.png").exists());
        remove_folder(&loud).await.unwrap();
        assert!(!loud.exists());
    }

    #[tokio::test]
    async fn captions_are_burned_in_with_the_bundled_font() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("talk.mp4");
        run(
            "ffmpeg",
            &[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=640x360:r=25:d=3",
                "-f",
                "lavfi",
                "-i",
                "sine=f=220:r=48000:d=3",
                "-shortest",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                text(&source).unwrap(),
            ],
            60,
        )
        .await
        .unwrap();
        let captions = crate::captions::parse(
            r#"{"cues":[{"start":0.2,"end":2.5,"text":"Hello captions","words":[{"start":0.2,"end":1.0,"text":"Hello"},{"start":1.0,"end":2.5,"text":"captions"}]}],"style":"bold","position":"middle"}"#,
        )
        .unwrap()
        .unwrap();
        let (script, srt) = caption_script(&captions, 3.0, None, 1.0, 640, 360);
        assert!(srt.starts_with("1\n00:00:00,120 --> "));
        assert!(srt.contains("Hello captions"));
        let fonts = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/fonts");
        let folder = caption_folder(&fonts, &script).await.unwrap();
        // libass sets the captions in the bundled face, not a system fallback.
        let probe_run = command_output_in(
            Some(folder.path()),
            "ffmpeg",
            &[
                "-v",
                "verbose",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=640x360:d=1",
                "-vf",
                "ass=captions.ass:fontsdir=fonts",
                "-ss",
                "0.5",
                "-frames:v",
                "1",
                "-f",
                "null",
                "-",
            ],
            60,
        )
        .await
        .unwrap();
        let log = String::from_utf8_lossy(&probe_run.stderr);
        assert!(log.contains("-> NotoSans-Bold"), "{log}");
        let brightest = |file: PathBuf| async move {
            run(
                "ffmpeg",
                &[
                    "-v",
                    "error",
                    "-ss",
                    "1.5",
                    "-i",
                    text(&file).unwrap(),
                    "-frames:v",
                    "1",
                    "-f",
                    "rawvideo",
                    "-pix_fmt",
                    "gray",
                    "pipe:1",
                ],
                60,
            )
            .await
            .unwrap()
            .into_iter()
            .max()
            .unwrap()
        };
        let captioned = tmp.path().join("captioned.mp4");
        render_captioned(
            &source,
            &captioned,
            0.0,
            3.0,
            "scale=640:360,setsar=1",
            false,
            None,
            640,
            360,
            None,
            0.2,
            true,
            None,
            25.0,
            None,
            "",
            1.0,
            Some(folder.path()),
        )
        .await
        .unwrap();
        assert!(brightest(captioned).await > 200);
        let plain = tmp.path().join("plain.mp4");
        render(
            &source,
            &plain,
            0.0,
            3.0,
            "scale=640:360,setsar=1",
            false,
            None,
            640,
            360,
            None,
            0.2,
            true,
            None,
            25.0,
            None,
            "",
            1.0,
        )
        .await
        .unwrap();
        assert!(brightest(plain).await < 40);
    }

    #[tokio::test]
    async fn deleting_a_project_removes_only_its_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join(Uuid::new_v4().to_string());
        let other = tmp.path().join(Uuid::new_v4().to_string());
        for dir in [&folder, &other] {
            std::fs::create_dir_all(dir).unwrap();
            std::fs::write(dir.join("source.mp4"), b"video").unwrap();
        }
        remove_folder(&folder).await.unwrap();
        assert!(!folder.exists());
        assert!(other.join("source.mp4").is_file());
        remove_folder(&folder).await.unwrap();
    }

    #[test]
    fn rejects_invalid_cuts() {
        assert!(valid_range(0., 0.25, 2.));
        for (a, b) in [(-1., 1.), (0., 3.), (1., 1.1), (f64::NAN, 1.)] {
            assert!(!valid_range(a, b, 2.));
        }
    }
    fn source_plan(video: serde_json::Value, audio: Option<serde_json::Value>) -> CopyPlan {
        plan_with(video, audio, Playable::default())
    }
    fn plan_with(
        video: serde_json::Value,
        audio: Option<serde_json::Value>,
        playable: Playable,
    ) -> CopyPlan {
        let mut streams = vec![video];
        if let Some(audio) = audio {
            streams.push(audio);
        }
        import_plan(&serde_json::json!({ "streams": streams }), playable)
    }
    #[test]
    fn software_import_uses_the_fast_x264_preset() {
        assert_eq!(
            import_transcode_args("in.mp4", "out.mp4", &SOFTWARE_ENCODER),
            vec![
                "-v",
                "error",
                "-nostdin",
                "-protocol_whitelist",
                "file,pipe",
                "-i",
                "in.mp4",
                "-map",
                "0:V:0",
                "-map",
                "0:a:0?",
                "-vf",
                IMPORT_SCALE,
                "-c:v",
                "libx264",
                "-crf",
                "20",
                "-preset",
                "superfast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
                "out.mp4",
            ]
        );
        for encoder in HARDWARE_ENCODERS {
            let args = import_transcode_args("in.mp4", "out.mp4", encoder);
            assert!(args
                .windows(2)
                .any(|pair| pair == ["-c:v", encoder.codec].as_slice()));
            assert!(args.contains(&IMPORT_SCALE));
            assert!(args
                .windows(2)
                .any(|pair| pair == ["-pix_fmt", "yuv420p"].as_slice()));
            assert!(!args
                .windows(2)
                .any(|pair| pair == ["-c:v", "libx264"].as_slice()));
        }
    }
    #[test]
    fn already_editable_video_is_copied_and_the_rest_is_transcoded() {
        let video = serde_json::json!({
            "codec_type": "video",
            "codec_name": "h264",
            "pix_fmt": "yuv420p",
            "width": 1280,
            "height": 640,
            "sample_aspect_ratio": "1:1"
        });
        let aac = serde_json::json!({"codec_type": "audio", "codec_name": "aac"});
        assert_eq!(
            source_plan(video.clone(), Some(aac)),
            CopyPlan::Stream(Codec::H264)
        );
        assert_eq!(
            source_plan(video.clone(), None),
            CopyPlan::Stream(Codec::H264)
        );
        let mp3 = serde_json::json!({"codec_type": "audio", "codec_name": "mp3"});
        assert_eq!(
            source_plan(video.clone(), Some(mp3)),
            CopyPlan::VideoOnly(Codec::H264)
        );
        let mut full_range = video.clone();
        full_range["pix_fmt"] = serde_json::json!("yuvj420p");
        assert_eq!(source_plan(full_range, None), CopyPlan::Transcode);
        let mut large = video.clone();
        large["width"] = serde_json::json!(3840);
        large["height"] = serde_json::json!(2160);
        assert_eq!(source_plan(large, None), CopyPlan::Transcode);
        let mut odd = video.clone();
        odd["width"] = serde_json::json!(1919);
        assert_eq!(source_plan(odd, None), CopyPlan::Transcode);
        let mut wide = video.clone();
        wide["sample_aspect_ratio"] = serde_json::json!("4:3");
        assert_eq!(source_plan(wide, None), CopyPlan::Transcode);
        let mut turned = video.clone();
        turned["side_data_list"] = serde_json::json!([{ "rotation": -90 }]);
        assert_eq!(source_plan(turned, None), CopyPlan::Transcode);
        let mut hevc = video;
        hevc["codec_name"] = serde_json::json!("hevc");
        assert_eq!(source_plan(hevc, None), CopyPlan::Transcode);
    }
    #[test]
    fn an_original_the_player_can_play_is_kept() {
        let av1 = serde_json::json!({
            "codec_type": "video",
            "codec_name": "av1",
            "pix_fmt": "yuv420p",
            "width": 1920,
            "height": 1080,
            "sample_aspect_ratio": "1:1"
        });
        let opus = serde_json::json!({"codec_type": "audio", "codec_name": "opus"});
        let vorbis = serde_json::json!({"codec_type": "audio", "codec_name": "vorbis"});
        let all = Playable {
            hevc: true,
            av1: true,
            vp9: true,
            opus: true,
        };
        assert_eq!(
            plan_with(av1.clone(), Some(opus.clone()), all),
            CopyPlan::Stream(Codec::Av1)
        );
        let no_opus = Playable { opus: false, ..all };
        assert_eq!(
            plan_with(av1.clone(), Some(opus.clone()), no_opus),
            CopyPlan::VideoOnly(Codec::Av1)
        );
        assert_eq!(
            plan_with(av1.clone(), Some(vorbis), all),
            CopyPlan::VideoOnly(Codec::Av1)
        );
        let no_av1 = Playable { av1: false, ..all };
        assert_eq!(
            plan_with(av1.clone(), Some(opus.clone()), no_av1),
            CopyPlan::Transcode
        );
        let mut ten_bit = av1.clone();
        ten_bit["pix_fmt"] = serde_json::json!("yuv420p10le");
        assert_eq!(plan_with(ten_bit, None, all), CopyPlan::Transcode);
        let mut uhd = av1.clone();
        uhd["width"] = serde_json::json!(3840);
        uhd["height"] = serde_json::json!(2160);
        assert_eq!(plan_with(uhd, None, all), CopyPlan::Transcode);
        let mut hevc = av1.clone();
        hevc["codec_name"] = serde_json::json!("hevc");
        assert_eq!(plan_with(hevc, None, all), CopyPlan::Stream(Codec::Hevc));
        let mut vp9 = av1;
        vp9["codec_name"] = serde_json::json!("vp9");
        assert_eq!(
            plan_with(vp9, Some(opus), all),
            CopyPlan::Stream(Codec::Vp9)
        );
        let mut tagged = stream_copy_args("in.mkv", "out.mp4", Codec::Hevc);
        assert!(tagged.windows(2).any(|pair| pair == ["-tag:v", "hvc1"]));
        tagged = stream_copy_args("in.mkv", "out.mp4", Codec::Av1);
        assert!(!tagged.contains(&"-tag:v"));
    }

    #[tokio::test]
    async fn a_playable_vp9_original_is_kept_without_reencoding() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("stream.webm");
        run(
            "ffmpeg",
            &[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=320x180:r=30:d=2",
                "-f",
                "lavfi",
                "-i",
                "sine=f=440:r=48000:d=2",
                "-shortest",
                "-c:v",
                "libvpx-vp9",
                "-deadline",
                "realtime",
                "-cpu-used",
                "8",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "libopus",
                text(&source).unwrap(),
            ],
            60,
        )
        .await
        .unwrap();
        let playable = Playable {
            vp9: true,
            opus: true,
            ..Playable::default()
        };
        let mut notes = Vec::new();
        let mut track = Tracker::new(IMPORT_STEPS.to_vec(), |step| notes.push(step));
        let imported = ingest_into(
            &tmp.path().join("library"),
            &source,
            "Stream".into(),
            playable,
            &mut track,
        )
        .await
        .unwrap();
        drop(track);
        assert!(notes
            .iter()
            .any(|s| s.label == "Keeping the original VP9 video and audio (no re-encode)"));
        let probe_out = run(
            "ffprobe",
            &[
                "-v",
                "error",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "csv=p=0",
                text(&imported.path).unwrap(),
            ],
            30,
        )
        .await
        .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&probe_out)
                .split_whitespace()
                .collect::<Vec<_>>(),
            ["vp9", "opus"]
        );
        assert_eq!(imported.frames.len(), FRAME_COUNT);
        assert!(imported.frames.iter().all(|p| p.is_file()));
        // The same source re-encodes to H.264 when the player cannot play VP9.
        let mut track = Tracker::new(IMPORT_STEPS.to_vec(), |_| {});
        let encoded = ingest_into(
            &tmp.path().join("library"),
            &source,
            "Stream".into(),
            Playable::default(),
            &mut track,
        )
        .await
        .unwrap();
        let (_, width, height, _, audio) = probe(&encoded.path).await.unwrap();
        assert_eq!((width, height, audio), (320, 180, true));
        let codec = run(
            "ffprobe",
            &[
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "csv=p=0",
                text(&encoded.path).unwrap(),
            ],
            30,
        )
        .await
        .unwrap();
        assert_eq!(String::from_utf8_lossy(&codec).trim(), "h264");
    }
    #[tokio::test]
    async fn a_full_range_import_is_reencoded_and_stays_playable() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("full-range.mp4");
        run(
            "ffmpeg",
            &[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x180:r=24:d=1",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=48000:cl=stereo:d=1",
                "-shortest",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuvj420p",
                "-c:a",
                "aac",
                text(&source).unwrap(),
            ],
            60,
        )
        .await
        .unwrap();
        let mut notes = Vec::new();
        let mut track = Tracker::new(IMPORT_STEPS.to_vec(), |step| notes.push(step));
        let imported = ingest_into(
            &tmp.path().join("library"),
            &source,
            "Full range".into(),
            Playable::default(),
            &mut track,
        )
        .await
        .unwrap();
        drop(track);
        assert!(notes
            .iter()
            .any(|step| step.index == 0 && step.label.starts_with("Re-encoding to H.264 with ")));
        assert!(notes
            .iter()
            .all(|step| step.fraction.is_none_or(|f| (0.0..=1.0).contains(&f))));
        assert_eq!(
            notes.iter().map(|step| step.index).max(),
            Some(IMPORT_STEPS.len() - 1)
        );
        assert!(notes[notes.len() - 1]
            .about
            .as_deref()
            .is_some_and(|about| about.starts_with("“Full range” · 320×180 · 0:01")));
        let (duration, width, height, _, audio) = probe(&imported.path).await.unwrap();
        assert!((duration - 1.0).abs() < 0.25);
        assert_eq!((width, height, audio), (320, 180, true));
        assert_eq!(imported.frames.len(), FRAME_COUNT);
    }
    #[test]
    fn pauses_keep_a_little_quiet_and_only_when_it_is_worth_it() {
        let log = "[silencedetect @ x] silence_start: 1.0\n[silencedetect @ x] silence_end: 2.2 | silence_duration: 1.2\n";
        let spans = parse_silences(log, 3.2);
        assert_eq!(spans, vec![(1.0, 2.2)]);
        let kept = applied_keeps(&spans, 3.2).unwrap();
        assert_eq!(kept, vec![(0.0, 1.12), (2.08, 3.2)]);
        assert_eq!(
            video_select(&kept, 24.0),
            "fps=24,select='gte(t,0.000)*lt(t,1.120)+gte(t,2.080)*lt(t,3.200)',setpts=N/FRAME_RATE/TB"
        );
        assert_eq!(
            audio_select(&kept),
            "aselect='gte(t,0.000)*lt(t,1.120)+gte(t,2.080)*lt(t,3.200)',asetpts=N/SR/TB"
        );
        assert_eq!(sound_chain(false, None, 1.0), None);
        assert_eq!(
            sound_chain(true, None, 1.0).as_deref(),
            Some("highpass=f=90")
        );
        assert_eq!(sound_chain(false, None, 1.5).as_deref(), Some("atempo=1.5"));
        assert_eq!(
            sound_chain(true, None, 1.25).as_deref(),
            Some("atempo=1.25,highpass=f=90")
        );
        assert_eq!(pace_video("setsar=1", 1.0), "setsar=1");
        assert_eq!(pace_video("setsar=1", 1.5), "setsar=1,setpts=PTS/1.5");
        assert_eq!(pace_video("setsar=1", 1.1), "setsar=1,setpts=PTS/1.1");
        assert_eq!(pace_video("setsar=1", 1.25), "setsar=1,setpts=PTS/1.25");
        assert_eq!(pace_video("setsar=1", 2.0), "setsar=1");
        let voiced = sound_chain(true, Some(&kept), 1.0).unwrap();
        let fast = sound_chain(true, Some(&kept), 1.5).unwrap();
        let atempo = fast.find("atempo=1.5").unwrap();
        assert!(fast.find("aselect=").unwrap() < atempo);
        assert!(atempo < fast.find("highpass=f=90").unwrap());
        assert!(voiced.starts_with("aselect="));
        assert!(voiced.ends_with(",highpass=f=90"));
        let open = parse_silences("silence_start: 1.5\n", 3.0);
        assert_eq!(applied_keeps(&open, 3.0).unwrap(), vec![(0.0, 1.62)]);
        let leading = applied_keeps(&[(0.0, 1.0)], 3.0).unwrap();
        assert_eq!(leading, vec![(0.88, 3.0)]);
        assert!(applied_keeps(&[(1.0, 1.5)], 4.0).is_none());
        assert!(applied_keeps(&[(0.0, 10.0)], 10.0).is_none());
        let blur = clip_filter("vertical", "blur", 1280, 640).unwrap();
        let picture = format!("{},{blur}", video_select(&kept, 24.0));
        assert!(picture.starts_with("fps=24,select="));
        assert!(picture.contains("boxblur=10:2"));
        let plan = plan_for(Some(&kept), 3.2, 10.0);
        assert_eq!(plan.count, 1);
        assert!((plan.seconds - 0.96).abs() < 0.001);
        assert_eq!(plan.cuts.len(), 1);
        assert!((plan.cuts[0].start - 11.12).abs() < 0.001);
        assert!((plan.cuts[0].end - 12.08).abs() < 0.001);
    }
    #[tokio::test]
    async fn pauses_shorten_a_clip_with_a_real_gap() {
        let tmp = tempfile::tempdir().unwrap();
        let gap = tmp.path().join("gap.mkv");
        run(
            "ffmpeg",
            &[
                "-v",
                "error",
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x180:r=24:d=3.2",
                "-filter_complex",
                "sine=frequency=440:sample_rate=48000:duration=1,aformat=channel_layouts=stereo[a1];anullsrc=r=48000:cl=stereo:d=1.2[a2];sine=frequency=440:sample_rate=48000:duration=1,aformat=channel_layouts=stereo[a3];[a1][a2][a3]concat=n=3:v=0:a=1[a]",
                "-map",
                "0:v",
                "-map",
                "[a]",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "pcm_s16le",
                "-shortest",
                text(&gap).unwrap(),
            ],
            60,
        )
        .await
        .unwrap();
        let (duration, _, _, fps, audio) = probe(&gap).await.unwrap();
        assert!(audio);
        let keeps = detect_keeps(&gap, 0.0, duration).await.unwrap();
        let keeps = keeps.expect("the gap should be long enough to cut");
        let full = tmp.path().join("full.mp4");
        render(
            &gap, &full, 0.0, duration, "setsar=1", false, None, 320, 180, None, 0.2, true, None,
            fps, None, "", 1.0,
        )
        .await
        .unwrap();
        let cut = tmp.path().join("cut.mp4");
        render(
            &gap,
            &cut,
            0.0,
            duration,
            "setsar=1",
            true,
            None,
            320,
            180,
            None,
            0.2,
            true,
            Some(&keeps),
            fps,
            None,
            "",
            1.0,
        )
        .await
        .unwrap();
        let (full_duration, _, _, _, full_audio) = probe(&full).await.unwrap();
        let (cut_duration, cut_w, cut_h, _, cut_audio) = probe(&cut).await.unwrap();
        assert!(full_audio && cut_audio);
        assert_eq!((cut_w, cut_h), (320, 180));
        assert!(full_duration - cut_duration > 0.4);
        let plate = decode_plate(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        )
        .unwrap();
        let png = tmp.path().join("headline.png");
        std::fs::write(&png, plate).unwrap();
        let mixed = tmp.path().join("mixed.mp4");
        render(
            &gap,
            &mixed,
            0.0,
            duration,
            "setsar=1",
            true,
            Some(&png),
            320,
            180,
            Some(&gap),
            0.2,
            true,
            Some(&keeps),
            fps,
            Some(&png),
            "top-left",
            1.0,
        )
        .await
        .unwrap();
        let (mixed_duration, _, _, _, mixed_audio) = probe(&mixed).await.unwrap();
        assert!(mixed_audio);
        assert!(full_duration - mixed_duration > 0.4);
        let marked = tmp.path().join("marked.mp4");
        render(
            &gap,
            &marked,
            0.0,
            duration,
            "setsar=1",
            false,
            None,
            320,
            180,
            None,
            0.2,
            true,
            None,
            fps,
            Some(&png),
            "bottom-right",
            1.0,
        )
        .await
        .unwrap();
        let (marked_duration, marked_w, marked_h, _, marked_audio) = probe(&marked).await.unwrap();
        assert!(marked_audio);
        assert_eq!((marked_w, marked_h), (320, 180));
        assert!((full_duration - marked_duration).abs() < 0.15);
    }
    #[tokio::test]
    async fn a_faster_clip_keeps_its_frames_and_ends_sooner() {
        let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/sample/alpine.mp4");
        let tmp = tempfile::tempdir().unwrap();
        let plate = decode_plate(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        )
        .unwrap();
        let png = tmp.path().join("plate.png");
        std::fs::write(&png, plate).unwrap();
        let output = tmp.path().join("fast.mp4");
        render(
            &sample,
            &output,
            2.0,
            3.5,
            "setsar=1",
            true,
            Some(&png),
            1280,
            640,
            None,
            0.2,
            true,
            None,
            24.0,
            None,
            "",
            1.5,
        )
        .await
        .unwrap();
        let (duration, w, h, _, audio) = probe(&output).await.unwrap();
        assert!(audio);
        assert_eq!((w, h), (1280, 640));
        // 1.5s of picture at 1.5× is about a second. A looped plate would pad back to 1.5s
        // if the output cap stayed on the source span.
        assert!(duration > 0.8 && duration < 1.2, "duration {duration}");
        // Each source frame is a brighter red, so a sped clip's later output shows a later source
        // frame. A cap that only chopped the timeline would still be showing the early frames.
        let clock = tmp.path().join("clock.mp4");
        run(
            "ffmpeg",
            &[
                "-v",
                "error",
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x180:r=24:d=1.5,format=rgb24,geq=r='clip(N*7,0,255)':g=0:b=0",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=48000:cl=stereo:d=1.5",
                "-shortest",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                text(&clock).unwrap(),
            ],
            60,
        )
        .await
        .unwrap();
        let read_red = |path: &Path| {
            let path = path.to_path_buf();
            async move {
                let bytes = run(
                    "ffmpeg",
                    &[
                        "-v",
                        "error",
                        "-nostdin",
                        "-i",
                        text(&path).unwrap(),
                        "-ss",
                        "0.85",
                        "-frames:v",
                        "1",
                        "-vf",
                        "format=rgb24,crop=1:1:8:8",
                        "-f",
                        "rawvideo",
                        "-pix_fmt",
                        "rgb24",
                        "-",
                    ],
                    30,
                )
                .await
                .unwrap();
                assert!(bytes.len() >= 3);
                bytes[0]
            }
        };
        let steady = tmp.path().join("steady.mp4");
        let rushed = tmp.path().join("rushed.mp4");
        render(
            &clock, &steady, 0.0, 1.5, "setsar=1", false, None, 320, 180, None, 0.2, true, None,
            24.0, None, "", 1.0,
        )
        .await
        .unwrap();
        render(
            &clock, &rushed, 0.0, 1.5, "setsar=1", false, None, 320, 180, None, 0.2, true, None,
            24.0, None, "", 1.5,
        )
        .await
        .unwrap();
        let (rushed_duration, _, _, _, rushed_audio) = probe(&rushed).await.unwrap();
        assert!(rushed_audio);
        assert!(
            rushed_duration > 0.8 && rushed_duration < 1.2,
            "duration {rushed_duration}"
        );
        let early = read_red(&steady).await;
        let late = read_red(&rushed).await;
        assert!(
            late > early.saturating_add(40),
            "speed 1× red {early}, 1.5× red {late}"
        );
    }
    #[test]
    fn logo_sits_in_the_same_corner_as_clip_ai() {
        let wide = logo_place(1920, 1080, "bottom-right").unwrap();
        assert_eq!(
            (wide.box_width, wide.box_height, wide.margin),
            (216, 108, 43)
        );
        assert_eq!((wide.top, wide.bottom), (43, 43));
        assert_eq!((wide.x.as_str(), wide.y.as_str()), ("W-w-43", "H-h-43"));
        let fitted = logo_fit(1920, 1080, 400, 200, "bottom-right").unwrap();
        assert_eq!(
            (fitted.width, fitted.height, fitted.x, fitted.y),
            (216, 108, 1661, 929)
        );
        let tall = logo_place(1080, 1920, "top-left").unwrap();
        assert_eq!(
            (tall.box_width, tall.box_height, tall.margin),
            (216, 108, 43)
        );
        assert_eq!((tall.top, tall.bottom), (173, 384));
        assert_eq!((tall.x.as_str(), tall.y.as_str()), ("43", "173"));
        let slim = logo_fit(1080, 1920, 100, 400, "bottom-right").unwrap();
        assert_eq!(
            (slim.width, slim.height, slim.x, slim.y),
            (27, 108, 1010, 1428)
        );
        let phone = logo_place(360, 640, "bottom-right").unwrap();
        assert_eq!(
            (phone.box_width, phone.box_height, phone.margin),
            (72, 36, 14)
        );
        assert_eq!((phone.top, phone.bottom), (58, 128));
        assert_eq!((phone.x.as_str(), phone.y.as_str()), ("W-w-14", "H-h-128"));
        let phone_fit = logo_fit(360, 640, 80, 40, "bottom-right").unwrap();
        assert_eq!(
            (phone_fit.width, phone_fit.height, phone_fit.x, phone_fit.y),
            (72, 36, 274, 476)
        );
        let phone_mark = logo_fit(360, 640, 32, 16, "top-right").unwrap();
        assert_eq!(
            (
                phone_mark.width,
                phone_mark.height,
                phone_mark.x,
                phone_mark.y
            ),
            (72, 36, 274, 58)
        );
        let source = logo_place(1280, 640, "top-right").unwrap();
        assert_eq!(
            (source.box_width, source.box_height, source.margin),
            (128, 64, 26)
        );
        assert_eq!((source.x.as_str(), source.y.as_str()), ("W-w-26", "26"));
        let source_fit = logo_fit(1280, 640, 200, 100, "top-right").unwrap();
        assert_eq!(
            (
                source_fit.width,
                source_fit.height,
                source_fit.x,
                source_fit.y
            ),
            (128, 64, 1126, 26)
        );
        let square = logo_fit(640, 640, 64, 128, "bottom-left").unwrap();
        assert_eq!(
            (square.width, square.height, square.x, square.y),
            (32, 64, 26, 550)
        );
        let half = logo_place(100, 250, "top-left").unwrap();
        assert_eq!((half.box_width, half.box_height, half.margin), (20, 10, 4));
        assert_eq!((half.top, half.bottom), (23, 50));
        assert_eq!((half.x.as_str(), half.y.as_str()), ("4", "23"));
        assert!(logo_place(100, 100, "center").is_err());
        let graph = logo_graph("setsar=1", 360, 640, "bottom-right", 1, false, false).unwrap();
        assert_eq!(
            graph,
            "[0:v]setsar=1[base];[1:v]scale=72:36:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba[brand];[base][brand]overlay=W-w-14:H-h-128,format=yuv420p[v]"
        );
        let stacked = logo_graph("setsar=1", 360, 640, "top-right", 2, true, true).unwrap();
        assert!(stacked.contains("overlay=0:0:shortest=1[plated]"));
        assert!(stacked.contains("[2:v]scale=72:36:"));
        assert!(stacked.ends_with("overlay=W-w-14:58:shortest=1,format=yuv420p[v]"));
        let mut header = b"\x89PNG\r\n\x1a\n".to_vec();
        header.extend_from_slice(&13u32.to_be_bytes());
        header.extend_from_slice(b"IHDR");
        header.extend_from_slice(&32u32.to_be_bytes());
        header.extend_from_slice(&16u32.to_be_bytes());
        assert_eq!(png_size(&header).unwrap(), (32, 16));
        let tiny = decode_plate(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        )
        .unwrap();
        assert!(png_size(&tiny).is_err());
        assert!(png_size(b"not a png").is_err());
        assert_eq!(logo_name(Path::new("my_mark.png")), "my mark");
    }
}
