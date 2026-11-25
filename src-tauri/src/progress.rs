//! The steps the studio shows while a long job runs: which stage, how far along, and what is left.
use serde::Serialize;
use std::time::{Duration, Instant};

/// One `studio-step` event.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    /// Every stage of the job, in order.
    pub steps: Vec<&'static str>,
    /// The stage under way, from 0.
    pub index: usize,
    /// What is happening now.
    pub label: String,
    /// 0 to 1 when the work has a known size.
    pub fraction: Option<f64>,
    /// Sizes, rates, and time left.
    pub detail: Option<String>,
    /// The video being worked on: its title, frame size, and length.
    pub about: Option<String>,
}

/// Sends steps for one job. Repeats of the same stage and label are held to a few a second.
pub struct Tracker<'a> {
    steps: Vec<&'static str>,
    about: Option<String>,
    last: Option<(usize, String, Instant)>,
    send: Box<dyn FnMut(Step) + Send + 'a>,
}

const EVERY: Duration = Duration::from_millis(150);

impl<'a> Tracker<'a> {
    pub fn new(steps: Vec<&'static str>, send: impl FnMut(Step) + Send + 'a) -> Self {
        Self {
            steps,
            about: None,
            last: None,
            send: Box::new(send),
        }
    }

    pub fn about(&mut self, about: String) {
        self.about = Some(about);
    }

    pub fn show(
        &mut self,
        stage: &'static str,
        label: impl Into<String>,
        fraction: Option<f64>,
        detail: Option<String>,
    ) {
        let index = self.steps.iter().position(|s| *s == stage).unwrap_or(0);
        let label = label.into();
        let fraction = fraction
            .filter(|f| f.is_finite())
            .map(|f| f.clamp(0.0, 1.0));
        let now = Instant::now();
        if let Some((last_index, last_label, at)) = &self.last {
            let same = *last_index == index && *last_label == label;
            if same && now.duration_since(*at) < EVERY && fraction != Some(1.0) {
                return;
            }
        }
        self.last = Some((index, label.clone(), now));
        (self.send)(Step {
            steps: self.steps.clone(),
            index,
            label,
            fraction,
            detail,
            about: self.about.clone(),
        });
    }
}

/// `12:41`, or `1:02:05` past an hour.
pub fn clock(seconds: f64) -> String {
    let s = seconds.max(0.0).round() as u64;
    let (h, m, s) = (s / 3600, s / 60 % 60, s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

/// `about 40 s left`, `about 3 min left`, `about 1 h 5 min left`.
pub fn left(seconds: f64) -> Option<String> {
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    let s = seconds.ceil() as u64;
    Some(if s < 60 {
        format!("about {} s left", s.max(1))
    } else if s < 3600 {
        format!("about {} min left", s.div_ceil(60))
    } else {
        format!("about {} h {} min left", s / 3600, s % 3600 / 60)
    })
}

pub fn bytes(n: f64) -> String {
    const MB: f64 = 1024.0 * 1024.0;
    if n >= 1024.0 * MB {
        format!("{:.2} GB", n / (1024.0 * MB))
    } else if n >= 10.0 * MB {
        format!("{:.0} MB", n / MB)
    } else {
        format!("{:.1} MB", n / MB)
    }
}

/// The line under the steps: `"Title" · 1920×1080 · 30:22 · 668 MB`.
pub fn media_about(
    title: &str,
    width: u64,
    height: u64,
    duration: f64,
    size: Option<u64>,
) -> String {
    let mut parts = Vec::new();
    let title = title.trim();
    if !title.is_empty() {
        parts.push(format!("“{title}”"));
    }
    if width > 0 && height > 0 {
        parts.push(format!("{width}×{height}"));
    }
    parts.push(clock(duration));
    if let Some(size) = size {
        parts.push(bytes(size as f64));
    }
    parts.join(" · ")
}

/// yt-dlp's progress, one line per update. `vcodec` is `none` for an audio-only stream.
pub const DOWNLOAD_TEMPLATE: &str = "download:qc-dl %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s %(info.vcodec)s";
/// Printed once the format is chosen and before the download starts.
pub const VIDEO_TEMPLATE: &str = "video:qc-info %(duration)s %(height)s %(title)s";

#[derive(Debug, PartialEq)]
pub struct Download {
    pub done: f64,
    pub total: Option<f64>,
    pub speed: Option<f64>,
    pub eta: Option<f64>,
    pub audio: bool,
}

fn number(field: Option<&str>) -> Option<f64> {
    field
        .and_then(|f| f.parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v >= 0.0)
}

pub fn download_line(line: &str) -> Option<Download> {
    let mut fields = line.strip_prefix("qc-dl ")?.split_whitespace();
    let done = number(fields.next())?;
    let total = number(fields.next());
    let estimate = number(fields.next());
    let speed = number(fields.next());
    let eta = number(fields.next());
    let audio = fields.next() == Some("none");
    Some(Download {
        done,
        total: total.or(estimate).filter(|t| *t > 0.0),
        speed,
        eta,
        audio,
    })
}

impl Download {
    pub fn fraction(&self) -> Option<f64> {
        self.total.map(|t| self.done / t)
    }
    pub fn detail(&self) -> String {
        let mut parts = vec![match self.total {
            Some(total) => format!("{} of {}", bytes(self.done), bytes(total)),
            None => bytes(self.done),
        }];
        if let Some(speed) = self.speed.filter(|s| *s > 0.0) {
            parts.push(format!("{}/s", bytes(speed)));
        }
        if let Some(eta) = self.eta.and_then(left) {
            parts.push(eta);
        }
        parts.join(" · ")
    }
}

/// `"Title" · 31:02 · 1080p` from the `qc-info` line, before anything is downloaded.
pub fn video_info(line: &str) -> Option<String> {
    let mut fields = line.strip_prefix("qc-info ")?.splitn(3, ' ');
    let duration = number(fields.next());
    let height = number(fields.next());
    let title = fields.next().unwrap_or("").trim();
    let mut parts = Vec::new();
    if !title.is_empty() && title != "NA" {
        parts.push(format!("“{title}”"));
    }
    if let Some(d) = duration {
        parts.push(clock(d));
    }
    if let Some(h) = height {
        parts.push(format!("{h:.0}p"));
    }
    (!parts.is_empty()).then(|| parts.join(" · "))
}

/// ffmpeg `-progress` output. A block of `key=value` lines ends with `progress=…`.
#[derive(Default)]
pub struct Encode {
    out: Option<f64>,
    speed: Option<f64>,
}

impl Encode {
    /// Seconds written so far and the speed against real time, once per block.
    pub fn line(&mut self, line: &str) -> Option<(f64, Option<f64>)> {
        let (key, value) = line.split_once('=')?;
        match key.trim() {
            "out_time_us" => self.out = number(Some(value.trim())).map(|us| us / 1e6),
            "speed" => self.speed = number(Some(value.trim().trim_end_matches('x'))),
            "progress" => return self.out.map(|out| (out, self.speed.filter(|s| *s > 0.0))),
            _ => {}
        }
        None
    }
}

/// `12:41 of 30:22 · 4.1× speed · about 4 min left`.
pub fn encode_detail(done: f64, duration: f64, speed: Option<f64>) -> String {
    let mut parts = vec![format!(
        "{} of {}",
        clock(done.min(duration)),
        clock(duration)
    )];
    if let Some(speed) = speed {
        parts.push(format!("{speed:.1}× speed"));
        if let Some(rest) = left((duration - done).max(0.0) / speed) {
            parts.push(rest);
        }
    }
    parts.join(" · ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times_and_sizes_read_naturally() {
        assert_eq!(clock(0.4), "0:00");
        assert_eq!(clock(761.0), "12:41");
        assert_eq!(clock(3725.0), "1:02:05");
        assert_eq!(left(0.2).unwrap(), "about 1 s left");
        assert_eq!(left(59.0).unwrap(), "about 59 s left");
        assert_eq!(left(61.0).unwrap(), "about 2 min left");
        assert_eq!(left(3900.0).unwrap(), "about 1 h 5 min left");
        assert_eq!(left(f64::NAN), None);
        assert_eq!(bytes(2_053_564.0), "2.0 MB");
        assert_eq!(bytes(668_030_276.0), "637 MB");
        assert_eq!(bytes(4.0 * 1024.0 * 1024.0 * 1024.0), "4.00 GB");
    }

    #[test]
    fn yt_dlp_progress_lines_become_steps() {
        let d = download_line("qc-dl 1048576 4194304 NA 2097152.5 2 avc1.640028").unwrap();
        assert_eq!(d.fraction(), Some(0.25));
        assert!(!d.audio);
        assert_eq!(d.detail(), "1.0 MB of 4.0 MB · 2.0 MB/s · about 2 s left");
        let audio = download_line("qc-dl 1048576 NA 2097152 NA NA none").unwrap();
        assert!(audio.audio);
        assert_eq!(audio.fraction(), Some(0.5));
        assert_eq!(audio.detail(), "1.0 MB of 2.0 MB");
        assert_eq!(download_line("qc-dl NA NA NA NA NA NA"), None);
        assert_eq!(download_line("[download] 10%"), None);
        assert_eq!(
            video_info("qc-info 1862.0 1080 A talk: part 2").unwrap(),
            "“A talk: part 2” · 31:02 · 1080p"
        );
        assert_eq!(video_info("qc-info NA NA NA"), None);
    }

    #[test]
    fn ffmpeg_progress_blocks_report_once_each() {
        let mut encode = Encode::default();
        let block = "frame=10\nout_time_us=N/A\nspeed=N/A\nprogress=continue";
        assert_eq!(block.lines().filter_map(|l| encode.line(l)).last(), None);
        let block = "frame=900\nout_time_us=30000000\nspeed=4.1x\nprogress=continue";
        assert_eq!(
            block
                .lines()
                .filter_map(|l| encode.line(l))
                .collect::<Vec<_>>(),
            vec![(30.0, Some(4.1))]
        );
        assert_eq!(
            encode_detail(30.0, 1822.0, Some(4.0)),
            "0:30 of 30:22 · 4.0× speed · about 8 min left"
        );
        assert_eq!(encode_detail(30.0, 60.0, None), "0:30 of 1:00");
    }

    #[test]
    fn a_tracker_names_the_stage_and_holds_back_repeats() {
        let mut seen = Vec::new();
        let mut track = Tracker::new(vec!["Download", "Editing copy"], |s| seen.push(s));
        track.about("“Clip” · 0:10".into());
        track.show("Download", "Downloading video", Some(0.1), None);
        track.show("Download", "Downloading video", Some(0.2), None);
        track.show("Download", "Downloading video", Some(1.4), None);
        track.show("Editing copy", "Copying video and audio", None, None);
        drop(track);
        assert_eq!(seen.len(), 3);
        assert_eq!(seen[0].index, 0);
        assert_eq!(seen[0].about.as_deref(), Some("“Clip” · 0:10"));
        assert_eq!(seen[1].fraction, Some(1.0));
        assert_eq!(
            (seen[2].index, seen[2].label.as_str()),
            (1, "Copying video and audio")
        );
    }
}
