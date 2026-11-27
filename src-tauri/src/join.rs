//! Several clips as one video (ClipCheap's "Make one video of these", clip-ai compose.py): each clip is rendered on its
//! own, with all its settings, then the parts are joined end to end, straight or with a transition, between an
//! optional opening shot and end card.
use crate::media::{self, ExportRequest, Result};
use crate::progress::Tracker;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;
use tokio::{fs, sync::watch};
use uuid::Uuid;

/// The longest opening shot or end card.
const MAX_BOOKEND_SECONDS: f64 = 60.0;
const MAX_BOOKEND_BYTES: u64 = 500 * 1024 * 1024;
/// The most clips joined into one video (ClipCheap's 40 clips on the main track).
pub const MAX_JOINED: usize = 40;
/// The joined video's frame rate.
const RATE: u32 = 30;

/// FFmpeg's `xfade` name for each of the studio's transitions; `cut` joins with none.
pub fn xfade_name(transition: &str) -> Result<Option<&'static str>> {
    Ok(match transition {
        "cut" | "" => None,
        "fade" => Some("fade"),
        "dissolve" => Some("dissolve"),
        "slide" => Some("slideleft"),
        "wipe" => Some("wipeleft"),
        "zoom" => Some("zoomin"),
        _ => return Err("Unknown transition.".into()),
    })
}

/// A part to join: how long it plays, and whether it has sound.
#[derive(Clone, Copy, Debug)]
pub struct Part {
    pub duration: f64,
    pub audio: bool,
}

/// How long a transition lasts: half a second, or a third of the shortest part.
pub fn overlap(parts: &[Part]) -> f64 {
    let shortest = parts
        .iter()
        .map(|part| part.duration)
        .fold(f64::INFINITY, f64::min);
    (shortest / 3.0).clamp(0.05, 0.5)
}

/// The filter graph joining `parts` (inputs 0..n) into `[v]` and `[a]` at `width` × `height`: each is fitted to the
/// frame (black bars when its shape differs), set to one frame rate and one sound format, then concatenated or, with
/// a transition, overlapped by `overlap` seconds. Returns the graph and the joined length.
pub fn join_graph(
    parts: &[Part],
    width: u32,
    height: u32,
    transition: Option<&str>,
) -> (String, f64) {
    let mut lines = Vec::new();
    for (i, part) in parts.iter().enumerate() {
        let d = part.duration;
        lines.push(format!(
            "[{i}:v]scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={RATE},format=yuv420p,trim=duration={d:.3},settb=AVTB,setpts=PTS-STARTPTS[v{i}]"
        ));
        lines.push(if part.audio {
            format!(
                "[{i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration={d:.3},asetpts=PTS-STARTPTS[a{i}]"
            )
        } else {
            format!(
                "anullsrc=r=48000:cl=stereo,atrim=duration={d:.3},aformat=sample_fmts=fltp:channel_layouts=stereo[a{i}]"
            )
        });
    }
    let total: f64 = parts.iter().map(|part| part.duration).sum();
    let n = parts.len();
    match transition {
        _ if n == 1 => {
            lines.push("[v0]null[v]".into());
            lines.push("[a0]anull[a]".into());
            (lines.join(";"), total)
        }
        None => {
            let inputs: String = (0..n).map(|i| format!("[v{i}][a{i}]")).collect();
            lines.push(format!("{inputs}concat=n={n}:v=1:a=1[v][a]"));
            (lines.join(";"), total)
        }
        Some(name) => {
            let d = overlap(parts);
            let mut offset = 0.0;
            let (mut video, mut sound) = ("v0".to_string(), "a0".to_string());
            for (i, part) in parts.iter().enumerate().skip(1) {
                offset += parts[i - 1].duration - d;
                let last = i == n - 1;
                let (v, a) = if last {
                    ("v".to_string(), "a".to_string())
                } else {
                    (format!("vx{i}"), format!("ax{i}"))
                };
                lines.push(format!(
                    "[{video}][v{i}]xfade=transition={name}:duration={d:.3}:offset={offset:.3}[{v}]"
                ));
                lines.push(format!(
                    "[{sound}][a{i}]acrossfade=d={d:.3}:c1=tri:c2=tri[{a}]"
                ));
                let _ = part;
                video = v;
                sound = a;
            }
            (lines.join(";"), total - d * (n - 1) as f64)
        }
    }
}

/// Joins video files into `target` at `size`, with an optional transition. Returns the joined length.
pub async fn join_files(
    files: &[PathBuf],
    target: &Path,
    size: (u32, u32),
    transition: &str,
) -> Result<f64> {
    let name = xfade_name(transition)?;
    if files.is_empty() {
        return Err("Choose at least one clip to join.".into());
    }
    let mut parts = Vec::with_capacity(files.len());
    for file in files {
        let (duration, _, _, _, audio) = media::probe(file).await?;
        if !(duration > 0.05) {
            return Err("One of the parts has no picture to join.".into());
        }
        parts.push(Part { duration, audio });
    }
    let (graph, length) = join_graph(&parts, size.0, size.1, name);
    let temp = tempfile::Builder::new()
        .suffix(".mp4")
        .tempfile_in(target.parent().ok_or("Invalid destination.")?)
        .map_err(|e| e.to_string())?
        .into_temp_path();
    let mut args: Vec<String> = vec!["-v".into(), "error".into(), "-nostdin".into(), "-y".into()];
    for file in files {
        args.extend(["-i".into(), media::text(file)?.to_string()]);
    }
    args.extend(
        [
            "-filter_complex",
            &graph,
            "-map",
            "[v]",
            "-map",
            "[a]",
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
        ]
        .map(String::from),
    );
    args.push(media::text(&temp)?.to_string());
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    media::run("ffmpeg", &refs, 7200).await?;
    temp.persist(target).map_err(|e| e.to_string())?;
    Ok(length)
}

#[derive(Serialize)]
pub struct BookendFile {
    path: String,
    name: String,
    duration: f64,
}

fn bookend_folder(app: &AppHandle) -> Result<PathBuf> {
    Ok(media::root(app)?.join("bookends"))
}

/// An opening shot or end card, copied into the library so the project keeps it.
pub async fn pick_bookend(app: AppHandle) -> Result<Option<BookendFile>> {
    let dialog = app
        .dialog()
        .file()
        .add_filter("Video", &["mp4", "mov", "m4v", "mkv", "webm"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let meta = fs::metadata(&path)
        .await
        .map_err(|_| "That video is missing.".to_string())?;
    if !meta.is_file() || meta.len() == 0 {
        return Err("That file has no video we can read.".into());
    }
    if meta.len() > MAX_BOOKEND_BYTES {
        return Err("Opening shots and end cards can be up to 500 MB.".into());
    }
    let (duration, width, height, _, _) = media::probe(&path).await?;
    if width == 0 || height == 0 || !(duration > 0.1) {
        return Err("That file has no video we can read.".into());
    }
    if duration > MAX_BOOKEND_SECONDS {
        return Err("Opening shots and end cards can be up to a minute long.".into());
    }
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    let folder = bookend_folder(&app)?;
    fs::create_dir_all(&folder)
        .await
        .map_err(|e| e.to_string())?;
    let dest = folder.join(format!("{}.{ext}", Uuid::new_v4()));
    fs::copy(&path, &dest).await.map_err(|e| e.to_string())?;
    let name = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Video")
        .replace(['_', '-'], " ")
        .chars()
        .take(80)
        .collect::<String>();
    Ok(Some(BookendFile {
        path: media::text(&dest)?.to_string(),
        name,
        duration: (duration * 1000.0).round() / 1000.0,
    }))
}

/// A saved bookend's file, only from the library's own folder.
async fn owned_bookend(app: &AppHandle, path: &str) -> Result<PathBuf> {
    let missing = || "The opening shot or end card is missing. Add it again.".to_string();
    let folder = fs::canonicalize(bookend_folder(app)?)
        .await
        .map_err(|_| missing())?;
    let file = fs::canonicalize(path).await.map_err(|_| missing())?;
    if !file.starts_with(&folder) || file == folder {
        return Err(missing());
    }
    Ok(file)
}

/// Renders each request as its own part, then joins them, between the bookends, into a file the user chooses.
pub async fn export_joined(
    app: AppHandle,
    id: String,
    requests: Vec<ExportRequest>,
    transition: String,
    intro: Option<String>,
    outro: Option<String>,
    mut cancel: watch::Receiver<bool>,
) -> Result<Option<String>> {
    xfade_name(&transition)?;
    if !(1..=MAX_JOINED).contains(&requests.len()) {
        return Err("Join between 1 and 40 clips.".into());
    }
    let intro = match intro.filter(|path| !path.is_empty()) {
        Some(path) => Some(owned_bookend(&app, &path).await?),
        None => None,
    };
    let outro = match outro.filter(|path| !path.is_empty()) {
        Some(path) => Some(owned_bookend(&app, &path).await?),
        None => None,
    };
    let items = media::prepare_all(&app, &id, requests).await?;
    let title = items
        .first()
        .map(|(_, item)| item.title().to_string())
        .unwrap_or_default();
    let dialog = app
        .dialog()
        .file()
        .add_filter("MPEG-4 video", &["mp4"])
        .set_file_name(format!("joined-{}.mp4", media::file_stem(&title)));
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
    if target.starts_with(media::root(&app)?) {
        return Err("Choose a destination outside your source library.".into());
    }
    let parent = target.parent().ok_or("Invalid destination.")?;
    let work = tempfile::Builder::new()
        .prefix(".quikclip-join-")
        .tempdir_in(parent)
        .map_err(|e| e.to_string())?;
    let total = items.len();
    let mut progress = Tracker::new(vec!["Clips", "Joining"], |step| {
        let _ = app.emit("studio-step", step);
    });
    let mut files: Vec<PathBuf> = intro.into_iter().collect();
    for (index, (input, item)) in items.iter().enumerate() {
        progress.show(
            "Clips",
            format!("Rendering clip {} of {total}", index + 1),
            Some(index as f64 / total as f64),
            Some(item.title().to_string()),
        );
        let part = work.path().join(format!("part-{index:02}.mp4"));
        tokio::select! {
            biased;
            _ = cancel.changed() => return Err("Operation cancelled.".into()),
            result = media::render_part(&app, input, &part, item) => result?,
        };
        files.push(part);
    }
    files.extend(outro);
    // The joined frame is the first clip's.
    let first = &files[usize::from(files.len() > total)];
    let (_, width, height, _, _) = media::probe(first).await?;
    let size = (
        (width.max(2) as u32 / 2) * 2,
        (height.max(2) as u32 / 2) * 2,
    );
    progress.show(
        "Joining",
        if transition == "cut" {
            format!("Joining {} parts", files.len())
        } else {
            format!("Joining {} parts with a {transition}", files.len())
        },
        None,
        None,
    );
    tokio::select! {
        biased;
        _ = cancel.changed() => return Err("Operation cancelled.".into()),
        result = join_files(&files, &target, size, &transition) => { result?; }
    };
    Ok(Some(media::text(&target)?.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transitions_name_ffmpeg_filters_and_overlap_the_parts() {
        assert_eq!(xfade_name("cut").unwrap(), None);
        assert_eq!(xfade_name("slide").unwrap(), Some("slideleft"));
        assert!(xfade_name("spin").is_err());
        let parts = [
            Part {
                duration: 3.0,
                audio: true,
            },
            Part {
                duration: 2.0,
                audio: false,
            },
            Part {
                duration: 4.0,
                audio: true,
            },
        ];
        let (cut, length) = join_graph(&parts, 360, 640, None);
        assert!(cut.ends_with("[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]"));
        assert!(cut.contains("anullsrc=r=48000:cl=stereo,atrim=duration=2.000"));
        assert_eq!(length, 9.0);
        let (faded, length) = join_graph(&parts, 360, 640, Some("fade"));
        assert!(faded.contains("[v0][v1]xfade=transition=fade:duration=0.500:offset=2.500[vx1]"));
        assert!(faded.contains("[vx1][v2]xfade=transition=fade:duration=0.500:offset=4.000[v]"));
        assert!(faded.contains("[ax1][a2]acrossfade=d=0.500:c1=tri:c2=tri[a]"));
        assert_eq!(length, 8.0);
        let short = [
            Part {
                duration: 0.6,
                audio: true,
            },
            Part {
                duration: 3.0,
                audio: true,
            },
        ];
        assert!((overlap(&short) - 0.2).abs() < 1e-9);
    }

    #[tokio::test]
    async fn clips_join_straight_and_with_a_fade() {
        let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/sample/alpine.mp4");
        let tmp = tempfile::tempdir().unwrap();
        let mut files = Vec::new();
        for (i, (start, size)) in [(1.0, "360:640"), (4.0, "320:180")].iter().enumerate() {
            let part = tmp.path().join(format!("p{i}.mp4"));
            media::run(
                "ffmpeg",
                &[
                    "-v",
                    "error",
                    "-ss",
                    &start.to_string(),
                    "-t",
                    "1.5",
                    "-i",
                    media::text(&sample).unwrap(),
                    "-vf",
                    &format!("scale={size},setsar=1"),
                    "-y",
                    media::text(&part).unwrap(),
                ],
                60,
            )
            .await
            .unwrap();
            files.push(part);
        }
        let straight = tmp.path().join("straight.mp4");
        let length = join_files(&files, &straight, (360, 640), "cut")
            .await
            .unwrap();
        assert!((length - 3.0).abs() < 0.1);
        let (duration, w, h, _, audio) = media::probe(&straight).await.unwrap();
        assert!((duration - 3.0).abs() < 0.15, "{duration}");
        assert_eq!((w, h, audio), (360, 640, true));
        let faded = tmp.path().join("faded.mp4");
        join_files(&files, &faded, (360, 640), "fade")
            .await
            .unwrap();
        let (duration, _, _, _, _) = media::probe(&faded).await.unwrap();
        assert!((duration - 2.5).abs() < 0.15, "{duration}");
    }
}
