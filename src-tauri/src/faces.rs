//! Face samples for the calm camera. Windows uses the system face detector on frames
//! scaled so the long side is at most 960 px. A face that shows up in only one sample is
//! ignored later, in `calmPath`. For following the speaker, each face also gets how much its
//! mouth moves (clip-ai `reframe.speaker_track`'s mouth activity), from two grey frames 0.12 s
//! apart.
use crate::media::{self, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Clone, Serialize)]
pub struct FaceBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// Mouth movement in grey levels, the face's own movement taken off. Only when asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion: Option<f64>,
}

#[derive(Clone, Serialize)]
pub struct FaceSample {
    pub time: f64,
    pub faces: Vec<FaceBox>,
}

/// At most about 160 frames, and never faster than twice a second. Following the speaker needs
/// a closer look: up to about 320 frames, four a second.
pub fn sample_step(span: f64, speaker: bool) -> f64 {
    let (fastest, most) = if speaker { (0.25, 320.0) } else { (0.5, 160.0) };
    if !(span.is_finite() && span > 0.0) {
        return fastest;
    }
    ((span / most).max(fastest) * 100.0).round() / 100.0
}

/// Seconds between the two grey frames a mouth's movement is measured across.
const MOUTH_GAP: f64 = 0.12;
/// Width of the grey frames.
const GREY_WIDTH: u32 = 320;

/// Mean absolute difference of two grey frames over a box given as fractions of the frame.
fn region_change(a: &[u8], b: &[u8], width: usize, height: usize, region: [f64; 4]) -> f64 {
    let [x0, y0, x1, y1] = region;
    let col = |v: f64| ((v.clamp(0.0, 1.0) * width as f64) as usize).min(width);
    let row = |v: f64| ((v.clamp(0.0, 1.0) * height as f64) as usize).min(height);
    let (left, right, top, bottom) = (col(x0), col(x1), row(y0), row(y1));
    if right <= left || bottom <= top {
        return 0.0;
    }
    let mut sum = 0u64;
    for y in top..bottom {
        let line = y * width;
        for x in left..right {
            sum += u64::from(a[line + x].abs_diff(b[line + x]));
        }
    }
    sum as f64 / ((right - left) * (bottom - top)) as f64
}

/// How much a face's mouth moves between two grey frames, less how much the face itself moves
/// (its eyes and brow), so a head turn or a camera move doesn't read as talking.
pub fn mouth_motion(a: &[u8], b: &[u8], width: usize, height: usize, face: &FaceBox) -> f64 {
    let x = |share: f64| face.x + face.w * share;
    let y = |share: f64| face.y + face.h * share;
    let mouth = region_change(a, b, width, height, [x(0.25), y(0.62), x(0.75), y(0.95)]);
    let brow = region_change(a, b, width, height, [x(0.2), y(0.15), x(0.8), y(0.45)]);
    ((mouth - brow).max(0.0) * 100.0).round() / 100.0
}

#[tauri::command]
pub async fn find_faces(
    app: AppHandle,
    id: String,
    start: f64,
    end: f64,
    speaker: Option<bool>,
) -> Result<Vec<FaceSample>> {
    let speaker = speaker.unwrap_or(false);
    let path = media::source(&app, &id)?;
    let (duration, width, height, _, _) = media::probe(&path).await?;
    if !media::valid_range(start, end, duration) {
        return Err("The cut must be inside the source and at least 0.25 seconds long.".into());
    }
    #[cfg(not(windows))]
    {
        let _ = (path, start, end, speaker, width, height);
        Err("Face tracking is available in the Windows desktop app.".into())
    }
    #[cfg(windows)]
    {
        let step = sample_step(end - start, speaker);
        let mut samples = detect_clip(&path, start, end, step).await?;
        if speaker {
            add_motion(&path, start, end, step, width, height, &mut samples).await?;
        }
        Ok(samples)
    }
}

/// Grey frames of the clip at the sample step, `GREY_WIDTH` wide, from `offset` seconds after
/// its in point, as raw bytes.
#[cfg_attr(not(windows), allow(dead_code))]
async fn grey_frames(
    path: &Path,
    start: f64,
    span: f64,
    step: f64,
    size: (u32, u32),
) -> Result<Vec<u8>> {
    let input = media::text(path)?.to_string();
    let filter = format!(
        "fps={:.4},scale={}:{},format=gray",
        1.0 / step,
        size.0,
        size.1
    );
    media::run(
        "ffmpeg",
        &[
            "-v",
            "error",
            "-ss",
            &format!("{start:.3}"),
            "-t",
            &format!("{span:.3}"),
            "-i",
            &input,
            "-vf",
            &filter,
            "-f",
            "rawvideo",
            "-",
        ],
        600,
    )
    .await
}

/// Each face's mouth movement, from grey frames at each sample and 0.12 s after it.
#[cfg_attr(not(windows), allow(dead_code))]
async fn add_motion(
    path: &Path,
    start: f64,
    end: f64,
    step: f64,
    width: u64,
    height: u64,
    samples: &mut [FaceSample],
) -> Result<()> {
    if width == 0 || height == 0 {
        return Ok(());
    }
    let grey_h =
        ((GREY_WIDTH as f64 * height as f64 / width as f64 / 2.0).round() as u32).max(1) * 2;
    let size = (GREY_WIDTH, grey_h);
    let span = end - start;
    let now = grey_frames(path, start, span, step, size).await?;
    let later = grey_frames(path, start + MOUTH_GAP, span, step, size).await?;
    let frame = (size.0 * size.1) as usize;
    for (index, sample) in samples.iter_mut().enumerate() {
        let (from, to) = (index * frame, (index + 1) * frame);
        if to > now.len() || to > later.len() {
            break;
        }
        for face in &mut sample.faces {
            face.motion = Some(mouth_motion(
                &now[from..to],
                &later[from..to],
                size.0 as usize,
                size.1 as usize,
                face,
            ));
        }
    }
    Ok(())
}

#[cfg(windows)]
async fn detect_clip(path: &Path, start: f64, end: f64, step: f64) -> Result<Vec<FaceSample>> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let pattern = dir.path().join("f%04d.png");
    let start_s = format!("{start:.3}");
    let span_s = format!("{:.3}", end - start);
    let filter = format!(
        "fps={:.4},scale=960:960:force_original_aspect_ratio=decrease",
        1.0 / step
    );
    let pattern_s = media::text(&pattern)?.to_string();
    let input = media::text(path)?.to_string();
    media::run(
        "ffmpeg",
        &[
            "-v",
            "error",
            "-ss",
            &start_s,
            "-t",
            &span_s,
            "-i",
            &input,
            "-vf",
            &filter,
            "-start_number",
            "0",
            &pattern_s,
        ],
        600,
    )
    .await?;
    let mut frames = Vec::new();
    let mut listed = tokio::fs::read_dir(dir.path())
        .await
        .map_err(|e| e.to_string())?;
    while let Some(entry) = listed.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "png") {
            frames.push(path);
        }
    }
    frames.sort();
    if frames.is_empty() {
        return Err("No frames could be read from this clip.".into());
    }
    // The temp directory has to outlive the blocking read.
    let samples = tokio::task::spawn_blocking(move || read_faces(&frames, start, step))
        .await
        .map_err(|e| e.to_string())??;
    Ok(samples)
}

#[cfg(windows)]
fn init_com() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

#[cfg(windows)]
fn read_faces(frames: &[PathBuf], start: f64, step: f64) -> Result<Vec<FaceSample>> {
    use windows::Media::FaceAnalysis::FaceDetector;
    init_com();
    if !FaceDetector::IsSupported().map_err(|e| e.to_string())? {
        return Err("This PC can't detect faces.".into());
    }
    let detector = FaceDetector::CreateAsync()
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    let mut samples = Vec::with_capacity(frames.len());
    let mut failures = 0;
    let mut first_error = None;
    for (index, frame) in frames.iter().enumerate() {
        let time = start + index as f64 * step;
        let bytes = std::fs::read(frame).map_err(|e| e.to_string())?;
        let faces = match faces_in(&detector, &bytes) {
            Ok(faces) => faces,
            Err(error) => {
                failures += 1;
                if first_error.is_none() {
                    first_error = Some(error);
                }
                Vec::new()
            }
        };
        samples.push(FaceSample { time, faces });
    }
    if failures == frames.len() {
        return Err(first_error.unwrap_or_else(|| "No faces could be read.".into()));
    }
    Ok(samples)
}

#[cfg(windows)]
fn faces_in(
    detector: &windows::Media::FaceAnalysis::FaceDetector,
    png: &[u8],
) -> Result<Vec<FaceBox>> {
    use windows::Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat, SoftwareBitmap};
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
    let stream = InMemoryRandomAccessStream::new().map_err(|e| e.to_string())?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(|e| e.to_string())?;
    writer.WriteBytes(png).map_err(|e| e.to_string())?;
    writer
        .StoreAsync()
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    writer.DetachStream().map_err(|e| e.to_string())?;
    stream.Seek(0).map_err(|e| e.to_string())?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    let gray = SoftwareBitmap::Convert(&bitmap, BitmapPixelFormat::Gray8).unwrap_or(bitmap);
    let found = detector
        .DetectFacesAsync(&gray)
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    let width = gray.PixelWidth().map_err(|e| e.to_string())? as f64;
    let height = gray.PixelHeight().map_err(|e| e.to_string())? as f64;
    if width < 1.0 || height < 1.0 {
        return Ok(Vec::new());
    }
    let count = found.Size().map_err(|e| e.to_string())?;
    let mut faces = Vec::with_capacity(count as usize);
    for index in 0..count {
        let face = found.GetAt(index).map_err(|e| e.to_string())?;
        let bounds = face.FaceBox().map_err(|e| e.to_string())?;
        faces.push(FaceBox {
            x: bounds.X as f64 / width,
            y: bounds.Y as f64 / height,
            w: bounds.Width as f64 / width,
            h: bounds.Height as f64 / height,
            motion: None,
        });
    }
    Ok(faces)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn face_samples_stay_sparse_on_a_long_clip() {
        assert_eq!(sample_step(12.0, false), 0.5);
        assert_eq!(sample_step(36.0, false), 0.5);
        assert_eq!(sample_step(200.0, false), 1.25);
        assert_eq!(sample_step(7200.0, false), 45.0);
    }

    #[test]
    fn speaker_sampling_looks_closer() {
        assert_eq!(sample_step(60.0, false), 0.5);
        assert_eq!(sample_step(60.0, true), 0.25);
        assert_eq!(sample_step(3200.0, false), 20.0);
        assert_eq!(sample_step(3200.0, true), 10.0);
        assert_eq!(sample_step(f64::NAN, true), 0.25);
    }

    #[test]
    fn a_moving_mouth_reads_as_talking_and_a_moving_head_does_not() {
        let (w, h) = (20usize, 20usize);
        let still = vec![100u8; w * h];
        let face = FaceBox {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
            motion: None,
        };
        // The mouth (rows 12–19) changes; the brow does not.
        let mut talking = still.clone();
        for y in 13..19 {
            for x in 5..15 {
                talking[y * w + x] = 140;
            }
        }
        assert!(mouth_motion(&still, &talking, w, h, &face) > 20.0);
        // Everything changes alike: the head moved, nobody spoke.
        let moved = vec![140u8; w * h];
        assert_eq!(mouth_motion(&still, &moved, w, h, &face), 0.0);
        assert_eq!(mouth_motion(&still, &still, w, h, &face), 0.0);
    }

    #[tokio::test]
    async fn grey_frames_come_out_one_per_sample() {
        let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/sample/alpine.mp4");
        let bytes = grey_frames(&sample, 1.0, 2.0, 0.5, (32, 16)).await.unwrap();
        assert_eq!(bytes.len() % (32 * 16), 0);
        assert_eq!(bytes.len() / (32 * 16), 4);
    }
}
