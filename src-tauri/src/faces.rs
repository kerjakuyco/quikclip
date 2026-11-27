//! Face samples for the calm camera. Windows uses the system face detector on frames scaled so
//! the long side is at most 960 px; macOS and Linux, and a Windows PC without that detector, use
//! SeetaFace's frontal detector (the `rustface` port, BSD 2-Clause, its model bundled from
//! `models/`) on grey frames 640 px wide. A face that shows up in only one sample is ignored
//! later, in `calmPath`. For following the speaker, each face also gets how much its mouth moves
//! (clip-ai `reframe.speaker_track`'s mouth activity), from two grey frames 0.12 s apart.
use crate::media::{self, Result};
use serde::Serialize;
use std::path::Path;
#[cfg(windows)]
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// SeetaFace's frontal face model, bundled with the app (tauri.conf.json resources).
const MODEL_FILE: &str = "models/seeta_fd_frontal_v1.0.bin";
/// Width of the grey frames the portable detector reads.
const DETECT_WIDTH: u32 = 640;

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
    let step = sample_step(end - start, speaker);
    // The system detector where Windows has one, else the bundled one.
    #[cfg(windows)]
    let found = match detect_clip(&path, start, end, step).await {
        Ok(samples) => Ok(samples),
        Err(_) => detect_portable(&app, &path, start, end, step, width, height).await,
    };
    #[cfg(not(windows))]
    let found = detect_portable(&app, &path, start, end, step, width, height).await;
    let mut samples = found?;
    if speaker {
        add_motion(&path, start, end, step, width, height, &mut samples).await?;
    }
    Ok(samples)
}

/// Where the bundled face model is: beside the app, or in the source tree when run from it.
fn model_path(app: &AppHandle) -> std::path::PathBuf {
    let bundled = app.path().resource_dir().map(|dir| dir.join(MODEL_FILE));
    match bundled {
        Ok(path) if path.exists() => path,
        _ => Path::new(env!("CARGO_MANIFEST_DIR")).join(MODEL_FILE),
    }
}

/// Faces found by the bundled detector, on grey frames `DETECT_WIDTH` wide.
async fn detect_portable(
    app: &AppHandle,
    path: &Path,
    start: f64,
    end: f64,
    step: f64,
    width: u64,
    height: u64,
) -> Result<Vec<FaceSample>> {
    if width == 0 || height == 0 {
        return Err("This video has no picture to look for faces in.".into());
    }
    detect_video(&model_path(app), path, start, end, step, width, height).await
}

/// Faces in a video's frames, sampled `step` seconds apart, by the bundled detector.
async fn detect_video(
    model: &Path,
    path: &Path,
    start: f64,
    end: f64,
    step: f64,
    width: u64,
    height: u64,
) -> Result<Vec<FaceSample>> {
    let wide = DETECT_WIDTH.min(width as u32 / 2 * 2).max(2);
    let tall = ((wide as f64 * height as f64 / width as f64 / 2.0).round() as u32).max(1) * 2;
    let frames = grey_frames(path, start, end - start, step, (wide, tall)).await?;
    let model = model.to_path_buf();
    tokio::task::spawn_blocking(move || detect_grey(&model, &frames, wide, tall, start, step))
        .await
        .map_err(|e| e.to_string())?
}

/// Faces in grey frames (`width` × `height` bytes each, back to back), sampled `step` seconds
/// apart from `start`, found by SeetaFace's frontal detector, as shares of the frame.
pub fn detect_grey(
    model: &Path,
    frames: &[u8],
    width: u32,
    height: u32,
    start: f64,
    step: f64,
) -> Result<Vec<FaceSample>> {
    let file = std::fs::File::open(model)
        .map_err(|_| "The face model is missing from this install of Quikclip.".to_string())?;
    let model = rustface::read_model(std::io::BufReader::new(file))
        .map_err(|_| "The face model could not be read.".to_string())?;
    let mut detector = rustface::create_detector_with_model(model);
    // Faces down to a twentieth of the frame's height, as small as a wide shot's.
    detector.set_min_face_size((height / 20).max(20));
    detector.set_score_thresh(2.0);
    detector.set_pyramid_scale_factor(0.8);
    detector.set_slide_window_step(4, 4);
    let frame = (width * height) as usize;
    if frame == 0 || frames.len() < frame {
        return Err("No frames could be read from this clip.".into());
    }
    let share = |n: f64, of: u32| (n / of as f64).clamp(0.0, 1.0);
    Ok(frames
        .chunks_exact(frame)
        .enumerate()
        .map(|(index, pixels)| {
            let faces = detector
                .detect(&rustface::ImageData::new(pixels, width, height))
                .into_iter()
                .map(|face| {
                    let b = face.bbox();
                    let (x, y) = (share(b.x() as f64, width), share(b.y() as f64, height));
                    FaceBox {
                        x,
                        y,
                        w: share(b.x() as f64 + b.width() as f64, width) - x,
                        h: share(b.y() as f64 + b.height() as f64, height) - y,
                        motion: None,
                    }
                })
                .filter(|face| face.w > 0.0 && face.h > 0.0)
                .collect();
            FaceSample {
                time: start + index as f64 * step,
                faces,
            }
        })
        .collect())
}

/// Grey frames of the clip at the sample step, `size` big, from `start` for `span` seconds, as
/// raw bytes.
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

    /// A real face moving across real video: the portrait glides right over three seconds of a
    /// 1280 × 720 film, and every sample finds the face where it is at that moment.
    #[tokio::test]
    async fn a_face_moving_across_a_video_is_found_in_every_sample() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let tmp = tempfile::tempdir().unwrap();
        let film = tmp.path().join("moving.mp4");
        media::run(
            "ffmpeg",
            &[
                "-v",
                "error",
                "-loop",
                "1",
                "-i",
                dir.join("tests/assets/portrait.jpg").to_str().unwrap(),
                "-f",
                "lavfi",
                "-i",
                "color=c=0x1a1d24:s=1280x720:r=24:d=3",
                "-filter_complex",
                "[0:v]scale=480:600[p];[1:v][p]overlay=x='100+200*t':y=60:shortest=1",
                "-t",
                "3",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                film.to_str().unwrap(),
            ],
            120,
        )
        .await
        .unwrap();
        let samples = detect_video(&dir.join(MODEL_FILE), &film, 0.0, 3.0, 0.5, 1280, 720)
            .await
            .unwrap();
        assert_eq!(samples.len(), 6);
        for sample in &samples {
            assert_eq!(sample.faces.len(), 1, "at {}", sample.time);
            let face = &sample.faces[0];
            // The face's middle is 298 px into the 480 px portrait, which starts at 100 + 200t.
            let expected = (100.0 + 200.0 * sample.time + 298.0) / 1280.0;
            let middle = face.x + face.w / 2.0;
            assert!(
                (middle - expected).abs() < 0.04,
                "at {}: {middle} not {expected}",
                sample.time
            );
        }
    }

    /// A real face: NASA's portrait of Neil Armstrong (S69-31741, public domain; tests/assets),
    /// decoded to grey by the app's own ffmpeg, is found where it is.
    #[tokio::test]
    async fn the_bundled_detector_finds_a_real_face() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let photo = dir.join("tests/assets/portrait.jpg");
        let (width, height) = (400u32, 500u32);
        let grey = media::run(
            "ffmpeg",
            &[
                "-v",
                "error",
                "-i",
                photo.to_str().unwrap(),
                "-vf",
                &format!("scale={width}:{height},format=gray"),
                "-f",
                "rawvideo",
                "-",
            ],
            60,
        )
        .await
        .unwrap();
        // The same frame twice, as two samples half a second apart.
        let frames = [grey.clone(), grey].concat();
        let samples = detect_grey(&dir.join(MODEL_FILE), &frames, width, height, 3.0, 0.5).unwrap();
        assert_eq!(samples.len(), 2);
        assert_eq!(samples[1].time, 3.5);
        let face = &samples[0].faces;
        assert_eq!(face.len(), 1, "one face");
        let (cx, cy) = (face[0].x + face[0].w / 2.0, face[0].y + face[0].h / 2.0);
        // His face is right of centre, a quarter of the way down.
        assert!((0.55..0.70).contains(&cx), "{cx}");
        assert!((0.17..0.34).contains(&cy), "{cy}");
        assert!((0.12..0.35).contains(&face[0].w), "{}", face[0].w);
        // A frame with no one in it has no faces.
        let blank = vec![128u8; (width * height) as usize];
        let none = detect_grey(&dir.join(MODEL_FILE), &blank, width, height, 0.0, 1.0).unwrap();
        assert!(none[0].faces.is_empty());
    }

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
