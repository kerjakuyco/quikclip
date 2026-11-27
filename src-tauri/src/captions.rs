//! Burned-in captions, drawn as clip-ai draws them (clip-ai service/core.py): the clip's cues moved onto its timeline once
//! pauses are cut and the speed is set (`remap_cues`, `speed_cues`), paced a little ahead of the voice (`pace_cues`), and
//! set in one of four styles with libass (`to_ass`). The studio cuts the cues from the transcript and previews the same
//! rules (src/captions.ts, after clip-clients lib/caption-timing.ts).
use crate::media::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One timed word, in seconds.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Word {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// One caption: up to two lines of about 32 columns, on the clip's clock.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Cue {
    pub start: f64,
    pub end: f64,
    pub text: String,
    #[serde(default)]
    pub words: Vec<Word>,
    /// The line in a second language, shown under it ("Show both languages").
    #[serde(default)]
    pub translation: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    Clean,
    Bold,
    Karaoke,
    Pop,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Position {
    Bottom,
    Middle,
    Top,
}

/// What the studio sends with an export.
#[derive(Clone, Debug)]
pub struct Captions {
    pub cues: Vec<Cue>,
    pub style: Style,
    pub position: Position,
    pub color: &'static str,
    pub highlight: &'static str,
    /// Where captions on Top start, in pixels of the frame: under the headline when there is one.
    pub top: Option<f64>,
    /// The transcript's language, which picks the regional face for Han text.
    pub language: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    cues: Vec<Cue>,
    style: String,
    #[serde(default)]
    position: String,
    #[serde(default)]
    color: String,
    #[serde(default)]
    highlight: String,
    #[serde(default)]
    top: Option<f64>,
    #[serde(default)]
    language: Option<String>,
}

/// Quikclip's twelve caption colours (src/captions.ts CAPTION_COLORS): the studio's own ember, sage and graphite with
/// colours that hold up over video. Captions are white with an ember highlight unless a clip picks others.
pub const CAPTION_COLORS: [&str; 12] = [
    "#FFFFFF", "#FF8057", "#FFD166", "#93C4A2", "#5EE2C4", "#4CC9F0", "#7B93FF", "#B69CFF",
    "#FF8CC6", "#FF5A5F", "#F3E6D3", "#121315",
];
const TEXT_COLOR: &str = "#FFFFFF";
const HIGHLIGHT_COLOR: &str = "#FF8057";
const POP_INK: &str = "#141414";
/// The bundled face (public/fonts, SIL OFL), loaded by libass from the ffmpeg run's own folder.
pub const FONT: &str = "Noto Sans";
pub const FONT_FILES: [&str; 2] = ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"];
const MAX_LINE: usize = 32;
const MAX_CUES: usize = 5000;
// Pacing (clip-ai CAPTION_*): word times land on or after a word's onset and people read ahead.
const CAPTION_LEAD: f64 = 0.08;
const CAPTION_LINGER: f64 = 0.25;
const CAPTION_BRIDGE: f64 = 0.5;
const CAPTION_MIN: f64 = 0.8;
const CAPTION_FADE_IN: f64 = 0.12;
const CAPTION_FADE_OUT: f64 = 0.1;
const MIN_WORD_SECONDS: f64 = 0.06;
pub(crate) const SENTENCE_END: [&str; 7] = [".", "!", "?", "…", "。", "！", "？"];
pub(crate) const CLAUSE_END: [&str; 7] = [",", ";", ":", "、", "，", "；", "："];
const CLOSING: &str = "\"')]»”’」』）";

fn known(color: &str, fallback: &'static str) -> &'static str {
    CAPTION_COLORS
        .iter()
        .find(|c| c.eq_ignore_ascii_case(color))
        .copied()
        .unwrap_or(fallback)
}

fn clean_text(text: &str, limit: usize) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(limit)
        .collect()
}

/// The studio's captions for an export, checked. Empty or style "none" draws none.
pub fn parse(json: &str) -> Result<Option<Captions>> {
    if json.trim().is_empty() {
        return Ok(None);
    }
    let request: Request =
        serde_json::from_str(json).map_err(|_| "The captions could not be read.")?;
    let style = match request.style.as_str() {
        "clean" => Style::Clean,
        "bold" => Style::Bold,
        "karaoke" => Style::Karaoke,
        "pop" => Style::Pop,
        "none" => return Ok(None),
        _ => return Err("Unknown caption style.".into()),
    };
    if request.cues.len() > MAX_CUES {
        return Err("Too many captions for one clip.".into());
    }
    let finite = |a: f64, b: f64| a.is_finite() && b.is_finite() && a >= 0.0 && b >= a;
    let cues = request
        .cues
        .into_iter()
        .filter(|cue| finite(cue.start, cue.end))
        .map(|cue| Cue {
            start: cue.start,
            end: cue.end,
            text: clean_text(&cue.text, 200),
            words: cue
                .words
                .into_iter()
                .filter(|w| finite(w.start, w.end))
                .map(|w| Word {
                    text: clean_text(&w.text, 64),
                    ..w
                })
                .filter(|w| !w.text.is_empty())
                .collect(),
            translation: cue
                .translation
                .map(|t| clean_text(&t, 300))
                .filter(|t| !t.is_empty()),
        })
        .filter(|cue| !cue.text.is_empty())
        .collect();
    Ok(Some(Captions {
        cues,
        style,
        position: match request.position.as_str() {
            "middle" => Position::Middle,
            "top" => Position::Top,
            _ => Position::Bottom,
        },
        color: known(&request.color, TEXT_COLOR),
        highlight: known(&request.highlight, HIGHLIGHT_COLOR),
        top: request.top.filter(|t| t.is_finite() && *t >= 0.0),
        language: request.language.map(|l| l.chars().take(32).collect()),
    }))
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

/// A clip time on the clip with its pauses gone: a time inside a cut lands where the cut is (clip-ai remap_time).
pub fn remap_time(time: f64, kept: &[(f64, f64)]) -> f64 {
    let mut out = 0.0;
    for &(start, end) in kept {
        if time <= start {
            return round3(out);
        }
        if time <= end {
            return round3(out + time - start);
        }
        out += end - start;
    }
    round3(out)
}

/// Captions moved onto the clip with its pauses gone; a cue left with no time goes (clip-ai remap_cues).
pub fn remap_cues(cues: &[Cue], kept: &[(f64, f64)]) -> Vec<Cue> {
    cues.iter()
        .filter_map(|cue| {
            let (start, end) = (remap_time(cue.start, kept), remap_time(cue.end, kept));
            (end - start >= 0.05).then(|| Cue {
                start,
                end,
                text: cue.text.clone(),
                words: cue
                    .words
                    .iter()
                    .map(|w| Word {
                        start: remap_time(w.start, kept),
                        end: remap_time(w.end, kept),
                        text: w.text.clone(),
                    })
                    .collect(),
                translation: cue.translation.clone(),
            })
        })
        .collect()
}

/// Captions moved onto a sped-up clip's own timeline (clip-ai speed_cues).
pub fn speed_cues(cues: &[Cue], speed: f64) -> Vec<Cue> {
    if speed == 1.0 {
        return cues.to_vec();
    }
    let scale = |value: f64| round3(value / speed);
    cues.iter()
        .map(|cue| Cue {
            start: scale(cue.start),
            end: scale(cue.end),
            text: cue.text.clone(),
            words: cue
                .words
                .iter()
                .map(|w| Word {
                    start: scale(w.start),
                    end: scale(w.end),
                    text: w.text.clone(),
                })
                .collect(),
            translation: cue.translation.clone(),
        })
        .collect()
}

/// A cue as it is drawn.
#[derive(Clone, Debug, PartialEq)]
pub struct Paced {
    pub start: f64,
    pub end: f64,
    pub words: Vec<Word>,
    pub translation: Option<String>,
    pub fade_in: bool,
    pub fade_out: bool,
}

/// A cue's words moved `shift` earlier, in order, inside the cue, each at least MIN_WORD_SECONDS where the next word leaves
/// room (clip-ai _tidy_words).
fn tidy_words(words: &[Word], start: f64, end: f64, shift: f64) -> Vec<Word> {
    let mut ordered: Vec<&Word> = words.iter().filter(|w| !w.text.trim().is_empty()).collect();
    ordered.sort_by(|a, b| a.start.total_cmp(&b.start));
    let mut previous = start;
    ordered
        .iter()
        .enumerate()
        .map(|(index, word)| {
            let following = ordered
                .get(index + 1)
                .map(|next| (next.start - shift).max(start).min(end))
                .unwrap_or(end);
            let begin = (word.start - shift).max(previous).max(start).min(end);
            let finish = (word.end - shift)
                .max(begin + MIN_WORD_SECONDS)
                .min(following.max(begin))
                .min(end);
            previous = begin;
            Word {
                start: round3(begin),
                end: round3(finish.max(begin)),
                text: word.text.clone(),
            }
        })
        .collect()
}

/// Spread over the cue by length when it carries no word times (clip-ai _spread).
fn spread(text: &str, start: f64, end: f64) -> Vec<Word> {
    let parts: Vec<&str> = text.split_whitespace().collect();
    let total: usize = parts.iter().map(|p| p.chars().count()).sum();
    let mut cursor = start;
    parts
        .iter()
        .map(|part| {
            let length = (end - start) * part.chars().count() as f64 / total.max(1) as f64;
            let word = Word {
                start: round3(cursor),
                end: round3(cursor + length),
                text: part.to_string(),
            };
            cursor += length;
            word
        })
        .collect()
}

/// Cues as drawn: CAPTION_LEAD early, held through short pauses, long enough to read, never overlapping, within the clip
/// (`duration`). Each says whether it starts after or ends before an empty screen (clip-ai pace_cues).
pub fn pace_cues(cues: &[Cue], duration: Option<f64>) -> Vec<Paced> {
    let mut ordered: Vec<&Cue> = cues.iter().filter(|c| c.end > c.start).collect();
    ordered.sort_by(|a, b| a.start.total_cmp(&b.start));
    let first = |c: &Cue| c.words.iter().map(|w| w.start).fold(c.start, f64::min);
    let mut paced: Vec<Paced> = Vec::new();
    for (index, cue) in ordered.iter().enumerate() {
        let previous = paced.last().map(|p| p.end).unwrap_or(0.0);
        let start = (first(cue) - CAPTION_LEAD).max(previous).max(0.0);
        let limit = match ordered.get(index + 1) {
            Some(next) => Some((first(next) - CAPTION_LEAD).max(start)),
            None => duration.map(|d| d.max(start)),
        };
        let mut end = cue.end + CAPTION_LINGER;
        if let Some(limit) = limit {
            if limit - end < CAPTION_BRIDGE {
                end = limit;
            }
        }
        end = end.max(start + CAPTION_MIN);
        if let Some(limit) = limit {
            end = end.min(limit);
        }
        if end - start < 0.05 {
            continue;
        }
        let words = if cue.words.is_empty() {
            spread(&cue.text, start, end)
        } else {
            tidy_words(&cue.words, start, end, CAPTION_LEAD)
        };
        paced.push(Paced {
            start: round3(start),
            end: round3(end),
            words,
            translation: cue.translation.clone(),
            fade_in: paced.is_empty() || start - previous > 0.01,
            fade_out: true,
        });
    }
    for index in 0..paced.len() {
        paced[index].fade_out = paced
            .get(index + 1)
            .is_none_or(|next| next.start - paced[index].end > 0.01);
    }
    paced
}

fn hangul(c: char) -> bool {
    matches!(c as u32, 0x1100..=0x11ff | 0x3130..=0x318f | 0xac00..=0xd7af)
}
fn emoji(c: char) -> bool {
    matches!(c as u32, 0x1f300..=0x1f64f | 0x1f900..=0x1f9ff)
}
/// East Asian wide and full-width characters (and emoji), two columns each (Python east_asian_width W and F).
fn wide(c: char) -> bool {
    matches!(c as u32,
        0x1100..=0x115f | 0x2e80..=0x303e | 0x3041..=0x33ff | 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xa000..=0xa4cf
        | 0xac00..=0xd7a3 | 0xf900..=0xfaff | 0xfe30..=0xfe4f | 0xff00..=0xff60 | 0xffe0..=0xffe6
        | 0x1f300..=0x1f64f | 0x1f900..=0x1f9ff | 0x20000..=0x3fffd)
}
/// Scripts written without spaces (Han, kana): Hangul and emoji use spaces.
fn cjk(c: char) -> bool {
    wide(c) && !hangul(c) && !emoji(c)
}
pub fn display_width(text: &str) -> usize {
    text.chars().map(|c| if wide(c) { 2 } else { 1 }).sum()
}
fn spaced(left: &str, right: &str) -> bool {
    !(left.chars().last().is_some_and(cjk) || right.chars().next().is_some_and(cjk))
}
pub fn join_words<S: AsRef<str>>(texts: &[S]) -> String {
    let mut out = String::new();
    for text in texts.iter().map(AsRef::as_ref).filter(|t| !t.is_empty()) {
        if !out.is_empty() && spaced(&out, text) {
            out.push(' ');
        }
        out.push_str(text);
    }
    out
}
pub(crate) fn ends(text: &str, marks: &[&str]) -> bool {
    let trimmed = text.trim_end_matches(|c| CLOSING.contains(c));
    marks.iter().any(|mark| trimmed.ends_with(mark))
}
fn ends_phrase(text: &str) -> bool {
    ends(text, &SENTENCE_END) || ends(text, &CLAUSE_END)
}

/// The lines a caption's words wrap to: a balanced two-line split when it fits, preferring punctuation; greedy beyond that
/// (clip-ai wrap_ranges).
pub fn wrap_ranges<S: AsRef<str>>(texts: &[S], width: usize) -> Vec<(usize, usize)> {
    let count = texts.len();
    if count < 2 || display_width(&join_words(texts)) <= width {
        return if count > 0 { vec![(0, count)] } else { vec![] };
    }
    let mut best: Option<(i64, usize)> = None;
    for k in 1..count {
        let top = display_width(&join_words(&texts[..k]));
        let bottom = display_width(&join_words(&texts[k..]));
        if top <= width && bottom <= width {
            let score = top.max(bottom) as i64
                - if ends_phrase(texts[k - 1].as_ref()) {
                    6
                } else {
                    0
                };
            if best.is_none_or(|(best_score, _)| score < best_score) {
                best = Some((score, k));
            }
        }
    }
    if let Some((_, k)) = best {
        return vec![(0, k), (k, count)];
    }
    let (mut ranges, mut first) = (Vec::new(), 0);
    for i in 1..count {
        if display_width(&join_words(&texts[first..=i])) > width {
            ranges.push((first, i));
            first = i;
        }
    }
    ranges.push((first, count));
    ranges
}

/// Transcript text is untrusted: no override blocks, escapes, or line/control characters (clip-ai ass_text).
pub fn ass_text(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '\\' => '＼',
            '{' => '(',
            '}' => ')',
            c if c.is_control() || c == '\u{2028}' || c == '\u{2029}' => ' ',
            c => c,
        })
        .collect()
}

pub(crate) fn ass_time(seconds: f64) -> String {
    let total = (seconds.max(0.0) * 100.0).round() as u64;
    let (whole, fraction) = (total / 100, total % 100);
    format!(
        "{}:{:02}:{:02}.{fraction:02}",
        whole / 3600,
        whole / 60 % 60,
        whole % 60
    )
}

fn bgr(color: &str) -> String {
    let value = color.trim_start_matches('#').to_uppercase();
    format!("{}{}{}", &value[4..6], &value[2..4], &value[0..2])
}
/// A style colour field, &HAABBGGRR (alpha 0 is opaque).
pub(crate) fn ass_colour(color: &str, alpha: u8) -> String {
    format!("&H{alpha:02X}{}", bgr(color))
}
/// An inline \c override, &HBBGGRR&.
fn ass_inline(color: &str) -> String {
    format!("&H{}&", bgr(color))
}

/// sRGB relative luminance under 0.2: only near-black text needs a light outline (clip-ai is_dark).
pub fn is_dark(color: &str) -> bool {
    let value = color.trim_start_matches('#');
    let channel = |i: usize| {
        let c = u8::from_str_radix(&value[i..i + 2], 16).unwrap_or(255) as f64 / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4) < 0.2
}

fn compose(texts: &[String], decorate: &dyn Fn(usize, String) -> String) -> String {
    let mut parts = String::new();
    for (line, &(first, last)) in wrap_ranges(texts, MAX_LINE).iter().enumerate() {
        if line > 0 {
            parts.push_str("\\N");
        }
        for i in first..last {
            if i > first && spaced(&texts[i - 1], &texts[i]) {
                parts.push(' ');
            }
            parts.push_str(&decorate(i, ass_text(&texts[i])));
        }
    }
    parts
}

fn dialogue(layer: u8, start: f64, end: f64, style: &str, text: &str) -> String {
    format!(
        "Dialogue: {layer},{},{},{style},,0,0,0,,{text}",
        ass_time(start),
        ass_time(end)
    )
}

/// A \fad for an event `length` long: in when the cue follows an empty screen, out when one follows it.
fn fade(cue: &Paced, length: f64, fade_in: bool, fade_out: bool) -> String {
    let half = (length / 2.0).max(0.0);
    let in_ms = if fade_in && cue.fade_in {
        (CAPTION_FADE_IN.min(half) * 1000.0).round() as u64
    } else {
        0
    };
    let out_ms = if fade_out && cue.fade_out {
        (CAPTION_FADE_OUT.min(half) * 1000.0).round() as u64
    } else {
        0
    };
    if in_ms > 0 || out_ms > 0 {
        format!("{{\\fad({in_ms},{out_ms})}}")
    } else {
        String::new()
    }
}

/// Pop's groups: up to three words and 18 columns, broken after punctuation and at a pause (clip-ai _pop_groups).
fn pop_groups(words: &[Word]) -> Vec<Vec<Word>> {
    let mut groups: Vec<Vec<Word>> = Vec::new();
    let mut current: Vec<Word> = Vec::new();
    for word in words {
        if let Some(last) = current.last() {
            let mut texts: Vec<&str> = current.iter().map(|w| w.text.as_str()).collect();
            texts.push(&word.text);
            if current.len() == 3
                || display_width(&join_words(&texts)) > 18
                || ends_phrase(&last.text)
                || word.start - last.end >= 0.35
            {
                groups.push(std::mem::take(&mut current));
            }
        }
        current.push(word.clone());
    }
    if !current.is_empty() {
        groups.push(current);
    }
    groups
}

fn style_events(cue: &Paced, style: Style, size: i64, text: &str, high: &str) -> Vec<String> {
    let (start, end) = (cue.start, cue.end);
    let words: Vec<Word> = cue
        .words
        .iter()
        .map(|w| Word {
            // Bold and Pop are set in capitals, as the studio previews them.
            text: if matches!(style, Style::Bold | Style::Pop) {
                w.text.to_uppercase()
            } else {
                w.text.clone()
            },
            ..w.clone()
        })
        .collect();
    let texts: Vec<String> = words.iter().map(|w| w.text.clone()).collect();
    if texts.is_empty() || end <= start {
        return vec![];
    }
    let plain = |_: usize, t: String| t;
    match style {
        Style::Clean => vec![dialogue(
            0,
            start,
            end,
            "Caption",
            &format!(
                "{}{{\\blur{}}}{}",
                fade(cue, end - start, true, true),
                ((size as f64 * 0.05).round() as i64).max(1),
                compose(&texts, &plain)
            ),
        )],
        Style::Bold => {
            // One event per spoken word, that word in the highlight from its start until the next word's.
            let mut bounds = vec![start];
            bounds.extend(words[1..].iter().map(|w| w.start.max(start).min(end)));
            bounds.push(end);
            let spans: Vec<usize> = (0..words.len())
                .filter(|&i| bounds[i + 1] > bounds[i])
                .collect();
            spans
                .iter()
                .map(|&i| {
                    let lit = |j: usize, t: String| {
                        if j == i {
                            format!("{{\\c{high}}}{t}{{\\c{text}}}")
                        } else {
                            t
                        }
                    };
                    dialogue(
                        0,
                        bounds[i],
                        bounds[i + 1],
                        "Caption",
                        &(fade(
                            cue,
                            bounds[i + 1] - bounds[i],
                            Some(&i) == spans.first(),
                            Some(&i) == spans.last(),
                        ) + &compose(&texts, &lit)),
                    )
                })
                .collect()
        }
        Style::Karaoke => {
            // \kf sweeps each word over its spoken time; a pause before a word is an empty \k syllable.
            let marks = |t: f64| ((t.max(start).min(end) - start) * 100.0).round() as i64;
            let mut spans = Vec::new();
            let mut reached = 0;
            for (index, word) in words.iter().enumerate() {
                let following = words.get(index + 1).map(|w| w.start).unwrap_or(end);
                let begin = marks(word.start).max(reached);
                let finish = marks(word.end.max(word.start).min(following)).max(begin);
                spans.push((begin - reached, finish - begin));
                reached = finish;
            }
            let sweep = |j: usize, t: String| {
                let (wait, sung) = spans[j];
                let pause = if wait > 0 {
                    format!("{{\\k{wait}}}")
                } else {
                    String::new()
                };
                format!("{pause}{{\\kf{sung}}}{t}")
            };
            vec![dialogue(
                0,
                start,
                end,
                "Caption",
                &(fade(cue, end - start, true, true) + &compose(&texts, &sweep)),
            )]
        }
        Style::Pop => {
            let groups = pop_groups(&words);
            let mut events = Vec::new();
            for (g, group) in groups.iter().enumerate() {
                let first = if g > 0 {
                    start.max(group[0].start)
                } else {
                    start
                };
                let last = groups
                    .get(g + 1)
                    .map(|next| end.min(next[0].start))
                    .unwrap_or(end);
                let mut beats = vec![first];
                beats.extend(group[1..].iter().map(|w| w.start.max(first).min(last)));
                beats.push(last);
                let texts: Vec<String> = group.iter().map(|w| w.text.clone()).collect();
                for i in 0..group.len() {
                    if beats[i + 1] <= beats[i] {
                        continue;
                    }
                    let pop = if i == 0 {
                        "{\\fscx70\\fscy70\\t(0,90,\\fscx112\\fscy112)\\t(90,170,\\fscx100\\fscy100)}"
                    } else {
                        ""
                    };
                    let out = fade(
                        cue,
                        beats[i + 1] - beats[i],
                        false,
                        g + 1 == groups.len() && i + 1 == group.len(),
                    );
                    let boxed = |j: usize, t: String| {
                        if j == i {
                            format!("{{\\alpha&H00&}}{t}{{\\alpha&HFF&}}")
                        } else {
                            t
                        }
                    };
                    events.push(dialogue(
                        0,
                        beats[i],
                        beats[i + 1],
                        "Pop",
                        &format!("{out}{pop}{}", compose(&texts, &plain)),
                    ));
                    events.push(dialogue(
                        1,
                        beats[i],
                        beats[i + 1],
                        "PopBox",
                        &format!("{out}{pop}{{\\alpha&HFF&}}{}", compose(&texts, &boxed)),
                    ));
                }
            }
            events
        }
    }
}

/// A cue's second language, as a share of the caption size (clip-ai TRANSLATION_SCALE).
const TRANSLATION_SCALE: f64 = 0.62;

/// A cue's translation as the end of its caption text (clip-ai _translation): a smaller, plain block under the line in the
/// caption colour, so it moves with the captions wherever they sit. On Pop's box layer it inherits the hidden alpha; on
/// karaoke it is a syllable of its own, sung at once, so the last word's sweep doesn't stretch across it.
fn translation_block(cue: &Paced, size: i64, colour: &str, karaoke: bool) -> String {
    let Some(text) = cue.translation.as_deref().filter(|t| !t.trim().is_empty()) else {
        return String::new();
    };
    let small = ((size as f64 * TRANSLATION_SCALE).round() as i64).max(1);
    let parts: Vec<&str> = text.split_whitespace().collect();
    let width = (MAX_LINE as f64 / TRANSLATION_SCALE).round() as usize;
    let lines: Vec<String> = wrap_ranges(&parts, width)
        .into_iter()
        .map(|(a, b)| ass_text(&join_words(&parts[a..b])))
        .collect();
    format!(
        "{}\\N{{\\fs{small}\\b0\\bord{}\\shad0\\c{colour}}}{}",
        if karaoke { "{\\k0}" } else { "" },
        ((small as f64 * 0.08).round() as i64).max(1),
        lines.join("\\N")
    )
}

/// ASS font size at a 1080 px short side (clip-ai CAPTION_SIZES), and the bottom margin and Top start as shares of height.
fn caption_size(width: u32, height: u32, style: Style) -> f64 {
    let base = match (height.cmp(&width), style) {
        (std::cmp::Ordering::Greater, Style::Clean) => 66.0,
        (std::cmp::Ordering::Greater, Style::Pop) => 104.0,
        (std::cmp::Ordering::Greater, _) => 70.0,
        (std::cmp::Ordering::Equal, Style::Clean) => 62.0,
        (std::cmp::Ordering::Equal, Style::Pop) => 96.0,
        (std::cmp::Ordering::Equal, _) => 66.0,
        (std::cmp::Ordering::Less, Style::Clean) => 62.0,
        (std::cmp::Ordering::Less, Style::Pop) => 90.0,
        (std::cmp::Ordering::Less, _) => 66.0,
    };
    base * width.min(height) as f64 / 1080.0
}
fn caption_margin(width: u32, height: u32, pop: bool) -> f64 {
    let (line, popped) = match height.cmp(&width) {
        std::cmp::Ordering::Greater => (0.24, 0.30),
        std::cmp::Ordering::Equal => (0.09, 0.18),
        std::cmp::Ordering::Less => (0.08, 0.14),
    };
    if pop {
        popped
    } else {
        line
    }
}
fn caption_top(width: u32, height: u32) -> f64 {
    match height.cmp(&width) {
        std::cmp::Ordering::Greater => 0.14,
        std::cmp::Ordering::Equal => 0.09,
        std::cmp::Ordering::Less => 0.08,
    }
}

/// The captions as an ASS script for a `width` × `height` frame (clip-ai to_ass, without the headline: the studio draws
/// that as its own plate).
/// The face for the captions' text (clip-ai caption_font): the bundled Noto Sans, or for Korean, Japanese, or Chinese the
/// platform's own regional face, which libass finds through the system's fonts. Chinese is told from Japanese by kana, and
/// by the transcript's language for Han alone. Letters a face lacks still fall back glyph by glyph.
pub fn caption_font(text: &str, language: Option<&str>) -> &'static str {
    let chinese = language.map(str::to_lowercase).is_some_and(|l| {
        l.starts_with("zh")
            || l.starts_with("chinese")
            || l.starts_with("mandarin")
            || l.starts_with("cantonese")
    });
    let script = if text.chars().any(hangul) {
        "ko"
    } else if text.chars().any(|c| ('\u{3040}'..='\u{30ff}').contains(&c)) {
        "ja"
    } else if text
        .chars()
        .any(|c| ('\u{3400}'..='\u{4dbf}').contains(&c) || ('\u{4e00}'..='\u{9fff}').contains(&c))
    {
        if chinese {
            "zh"
        } else {
            "ja"
        }
    } else {
        return FONT;
    };
    #[cfg(target_os = "windows")]
    let faces = ("Malgun Gothic", "Yu Gothic", "Microsoft YaHei");
    #[cfg(target_os = "macos")]
    let faces = ("Apple SD Gothic Neo", "Hiragino Sans", "PingFang SC");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let faces = ("Noto Sans CJK KR", "Noto Sans CJK JP", "Noto Sans CJK SC");
    match script {
        "ko" => faces.0,
        "ja" => faces.1,
        _ => faces.2,
    }
}

fn srt_time(seconds: f64) -> String {
    let total = (seconds.max(0.0) * 1000.0).round() as u64;
    let (whole, millis) = (total / 1000, total % 1000);
    format!(
        "{:02}:{:02}:{:02},{millis:03}",
        whole / 3600,
        whole / 60 % 60,
        whole % 60
    )
}

/// The captions as SubRip, timed as they are drawn (clip-ai to_srt): for uploading beside the clip.
pub fn to_srt(cues: &[Paced]) -> String {
    let mut out = String::new();
    for (index, cue) in cues.iter().enumerate() {
        let texts: Vec<&str> = cue.words.iter().map(|w| w.text.as_str()).collect();
        let lines: Vec<String> = wrap_ranges(&texts, MAX_LINE)
            .into_iter()
            .map(|(a, b)| join_words(&texts[a..b]))
            .collect();
        // A translated line's second language goes under it, as the video shows it (clip-ai to_srt).
        let translation = cue
            .translation
            .as_deref()
            .map(|t| format!("\n{t}"))
            .unwrap_or_default();
        out.push_str(&format!(
            "{}\n{} --> {}\n{}{translation}\n\n",
            index + 1,
            srt_time(cue.start),
            srt_time(cue.end),
            lines.join("\n")
        ));
    }
    out
}

pub fn to_ass(cues: &[Paced], width: u32, height: u32, captions: &Captions) -> String {
    let style = captions.style;
    let size = caption_size(width, height, style).round() as i64;
    let side = (width as f64 * 0.06).round() as i64;
    let (text, high) = (captions.color, captions.highlight);
    let edge = if is_dark(text) { "#FFFFFF" } else { "#000000" };
    let (alignment, margin) = match captions.position {
        Position::Middle => (5, 0),
        Position::Top => (
            8,
            captions
                .top
                .unwrap_or(height as f64 * caption_top(width, height))
                .round() as i64,
        ),
        Position::Bottom => (
            2,
            (height as f64 * caption_margin(width, height, style == Style::Pop)).round() as i64,
        ),
    };
    let px = |share: f64| ((size as f64 * share).round() as i64).max(1);
    let all: String = cues
        .iter()
        .flat_map(|c| c.words.iter().map(|w| w.text.as_str()))
        .collect::<Vec<_>>()
        .join(" ");
    let font = caption_font(&all, captions.language.as_deref());
    let line = |name: &str, colours: String, bold: i8, border: u8, outline: i64, shadow: i64| {
        format!("Style: {name},{font},{size},{colours},{bold},0,0,0,100,100,0,0,{border},{outline},{shadow},{alignment},{side},{side},{margin},1")
    };
    let c = |color: &str| ass_colour(color, 0);
    let ink = if is_dark(high) { "#FFFFFF" } else { POP_INK };
    let styles = match style {
        Style::Clean => vec![line(
            "Caption",
            format!(
                "{},{},{},&H80000000",
                c(text),
                c(text),
                ass_colour(edge, 0x80)
            ),
            0,
            1,
            px(0.04),
            px(0.06),
        )],
        Style::Bold => vec![line(
            "Caption",
            format!("{},{},{},&H80000000", c(text), c(text), c(edge)),
            -1,
            1,
            px(0.12),
            px(0.04),
        )],
        // Karaoke sweeps from SecondaryColour (the text) to PrimaryColour (the highlight).
        Style::Karaoke => vec![line(
            "Caption",
            format!("{},{},{},&H80000000", c(high), c(text), c(edge)),
            -1,
            1,
            px(0.10),
            px(0.03),
        )],
        // Pop's box is the highlight, its ink dark or light against it.
        Style::Pop => vec![
            line(
                "Pop",
                format!("{},{},{},&H00000000", c(text), c(text), c(edge)),
                -1,
                1,
                px(0.12),
                0,
            ),
            line(
                "PopBox",
                format!("{},{},{},&H00000000", c(ink), c(ink), c(high)),
                -1,
                3,
                px(0.14),
                0,
            ),
        ],
    };
    let (text_inline, high_inline) = (ass_inline(text), ass_inline(high));
    let events: Vec<String> = cues
        .iter()
        .flat_map(|cue| {
            let after = translation_block(cue, size, &text_inline, style == Style::Karaoke);
            style_events(cue, style, size, &text_inline, &high_inline)
                .into_iter()
                .map(move |event| event + &after)
        })
        .collect();
    let mut script = format!(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n\
         [V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n{}\n\n\
         [Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
        styles.join("\n")
    );
    for event in events {
        script.push_str(&event);
        script.push('\n');
    }
    script
}

/// A transcript's words on the source clock: `offset` is where the transcribed audio starts. Words carry the punctuation
/// of their segment's text when the two line up one to one (OpenAI-style words have none, clip-ai _segment_words), and a
/// segment without word times is spread over its span. Non-speech events never become captions.
pub fn transcript_words(transcript: &Value, offset: f64) -> Vec<Word> {
    let number = |v: &Value| v.as_f64().filter(|n| n.is_finite());
    let word_of = |v: &Value| -> Option<Word> {
        if v.get("type")
            .and_then(Value::as_str)
            .is_some_and(|t| t != "word")
        {
            return None;
        }
        let text = clean_text(
            v.get("word")
                .or_else(|| v.get("text"))
                .and_then(Value::as_str)?,
            64,
        );
        let (start, end) = (number(&v["start"])?, number(&v["end"])?);
        (!text.is_empty() && end >= start).then_some(Word { start, end, text })
    };
    let segments: Vec<&Value> = transcript["segments"]
        .as_array()
        .map(|s| s.iter().collect())
        .unwrap_or_default();
    let loose: Vec<Word> = transcript["words"]
        .as_array()
        .map(|w| w.iter().filter_map(word_of).collect())
        .unwrap_or_default();
    let mut words = Vec::new();
    if segments.is_empty() {
        words = loose;
    } else {
        for segment in segments {
            let (Some(start), Some(end)) = (number(&segment["start"]), number(&segment["end"]))
            else {
                continue;
            };
            let text = clean_text(segment["text"].as_str().unwrap_or(""), 4000);
            let parts: Vec<&str> = text.split_whitespace().collect();
            let own: Vec<Word> = segment["words"]
                .as_array()
                .map(|w| w.iter().filter_map(word_of).collect())
                .unwrap_or_else(|| {
                    loose
                        .iter()
                        .filter(|w| {
                            let middle = (w.start + w.end) / 2.0;
                            middle >= start - 0.05 && middle <= end + 0.05
                        })
                        .cloned()
                        .collect()
                });
            if !own.is_empty() && own.len() == parts.len() {
                words.extend(own.into_iter().zip(parts).map(|(w, part)| Word {
                    text: part.chars().take(64).collect(),
                    ..w
                }));
            } else if !own.is_empty() {
                words.extend(own);
            } else if end > start && !parts.is_empty() {
                words.extend(spread(&text, start, end));
            }
        }
    }
    words.sort_by(|a, b| a.start.total_cmp(&b.start));
    words
        .into_iter()
        .map(|w| Word {
            start: round3(w.start + offset),
            end: round3(w.end + offset),
            text: w.text,
        })
        .collect()
}

/// The language the transcript reports, when it does.
pub fn transcript_language(transcript: &Value) -> Option<String> {
    transcript["language"]
        .as_str()
        .or_else(|| transcript["transcription_info"]["language"].as_str())
        .map(|l| l.chars().take(32).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(start: f64, end: f64, text: &str) -> Word {
        Word {
            start,
            end,
            text: text.into(),
        }
    }
    fn cue(words: Vec<Word>) -> Cue {
        Cue {
            start: words[0].start,
            end: words.last().unwrap().end,
            text: join_words(&words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>()),
            words,
            translation: None,
        }
    }
    fn look(style: Style) -> Captions {
        Captions {
            cues: vec![],
            style,
            position: Position::Bottom,
            color: TEXT_COLOR,
            highlight: HIGHLIGHT_COLOR,
            top: None,
            language: None,
        }
    }

    #[test]
    fn the_studio_request_is_checked() {
        assert!(parse("").unwrap().is_none());
        assert!(parse(r#"{"cues":[],"style":"none"}"#).unwrap().is_none());
        assert!(parse(r#"{"cues":[],"style":"shout"}"#).is_err());
        let c = parse(r##"{"cues":[{"start":0,"end":1,"text":"  hi   there ","words":[{"start":0,"end":0.4,"text":"hi"},{"start":-1,"end":1,"text":"bad"}]},{"start":2,"end":1,"text":"backwards"}],"style":"pop","position":"top","color":"#ff5a5f","highlight":"#123456","top":300}"##)
            .unwrap()
            .unwrap();
        assert_eq!(c.style, Style::Pop);
        assert_eq!(c.position, Position::Top);
        assert_eq!((c.color, c.highlight), ("#FF5A5F", HIGHLIGHT_COLOR));
        assert_eq!(c.cues.len(), 1);
        assert_eq!(c.cues[0].text, "hi there");
        assert_eq!(c.top, Some(300.0));
    }

    #[test]
    fn captions_follow_the_clip_when_pauses_go_and_it_speeds_up() {
        let cues = vec![cue(vec![w(0.5, 1.0, "one")]), cue(vec![w(3.0, 3.5, "two")])];
        // Kept: 0-1.2 and 2.8-4: the second cue moves 1.6 s earlier.
        let kept = [(0.0, 1.2), (2.8, 4.0)];
        let moved = remap_cues(&cues, &kept);
        assert_eq!((moved[1].start, moved[1].words[0].start), (1.4, 1.4));
        let fast = speed_cues(&moved, 1.25);
        assert_eq!((fast[1].start, fast[1].end), (1.12, 1.52));
        // A cue inside a cut collapses and goes.
        assert!(remap_cues(&[cue(vec![w(1.5, 2.5, "gone")])], &kept).is_empty());
    }

    #[test]
    fn cues_are_paced_ahead_of_the_voice_and_held_through_short_pauses() {
        let cues = vec![
            cue(vec![w(1.0, 1.3, "Hello"), w(1.3, 1.6, "there.")]),
            cue(vec![w(1.9, 2.2, "Again")]),
        ];
        let paced = pace_cues(&cues, Some(5.0));
        assert_eq!(paced[0].start, 0.92);
        // The gap to the next cue is shorter than the bridge, so the first holds until the next starts.
        assert_eq!(paced[0].end, paced[1].start);
        assert!(paced[0].fade_in && !paced[0].fade_out);
        assert!(!paced[1].fade_in && paced[1].fade_out);
        assert!(paced[1].end - paced[1].start >= CAPTION_MIN - 1e-9);
        assert_eq!(paced[0].words[0].start, 0.92);
    }

    #[test]
    fn long_text_wraps_into_two_balanced_lines() {
        let texts = [
            "This", "is", "a", "caption", "that", "runs", "past", "one", "line",
        ];
        assert_eq!(wrap_ranges(&texts, MAX_LINE), vec![(0, 5), (5, 9)]);
        assert_eq!(display_width("漢字"), 4);
        assert_eq!(join_words(&["漢", "字", "and", "more"]), "漢字and more");
    }

    #[test]
    fn every_style_draws_as_clip_ai_does() {
        let paced = pace_cues(
            &[cue(vec![
                w(0.2, 0.5, "make"),
                w(0.6, 0.9, "it"),
                w(1.0, 1.4, "{pop}"),
            ])],
            Some(3.0),
        );
        let bold = to_ass(&paced, 1080, 1920, &look(Style::Bold));
        assert!(bold.contains("PlayResX: 1080\nPlayResY: 1920"));
        assert!(bold.contains("Style: Caption,Noto Sans,70,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,8,3,2,65,65,461,1"));
        // One event per word, capitals, the spoken one ember (#FF8057 as BGR), braces made harmless.
        assert_eq!(bold.matches("Dialogue: ").count(), 3);
        assert!(bold.contains("{\\c&H5780FF&}MAKE{\\c&HFFFFFF&} IT (POP)"));
        let karaoke = to_ass(&paced, 1920, 1080, &look(Style::Karaoke));
        assert!(karaoke.contains("{\\kf"));
        assert!(karaoke.contains("Style: Caption,Noto Sans,66,&H005780FF,&H00FFFFFF"));
        let pop = to_ass(&paced, 1080, 1080, &look(Style::Pop));
        assert!(pop.contains("Style: PopBox,Noto Sans,96,&H00141414"));
        assert_eq!(pop.matches(",PopBox,").count(), 3);
        assert!(pop.contains("\\fscx70"));
        let clean = to_ass(&paced, 1080, 1920, &look(Style::Clean));
        assert!(clean.contains("{\\blur3}make it (pop)"));
        assert!(clean.contains("\\fad(120,100)"));
        let mut top = look(Style::Clean);
        top.position = Position::Top;
        top.top = Some(420.0);
        assert!(to_ass(&paced, 1080, 1920, &top).contains(",8,65,65,420,1"));
    }

    #[test]
    fn captions_in_korean_japanese_or_chinese_use_a_regional_face() {
        assert_eq!(caption_font("Hello there", None), FONT);
        let (ko, ja, zh) = (
            caption_font("안녕하세요", None),
            caption_font("こんにちは 世界", Some("zh")),
            caption_font("你好世界", Some("chinese")),
        );
        assert!(ko.contains("Gothic") || ko.contains("KR"));
        assert!(ja.contains("Gothic") || ja.contains("Hiragino") || ja.contains("JP"));
        assert!(zh.contains("YaHei") || zh.contains("PingFang") || zh.contains("SC"));
        // Han alone without a Chinese transcript reads as Japanese, as clip-ai's caption_font does.
        assert_eq!(caption_font("世界", Some("japanese")), ja);
        let mut chinese = look(Style::Clean);
        chinese.language = Some("zh".into());
        let paced = pace_cues(
            &[cue(vec![w(0.0, 1.0, "你好"), w(1.0, 2.0, "世界")])],
            Some(3.0),
        );
        assert!(to_ass(&paced, 1080, 1920, &chinese).contains(&format!("Style: Caption,{zh},")));
    }

    #[test]
    fn a_translation_sits_under_its_line_smaller_in_the_video_and_the_srt() {
        let mut both = cue(vec![w(0.5, 1.0, "Hello"), w(1.0, 1.4, "there.")]);
        both.translation = Some("Hola {ahí}.".into());
        let paced = pace_cues(&[both], Some(3.0));
        let bold = to_ass(&paced, 1080, 1920, &look(Style::Bold));
        // 70 pt captions, 43 pt translation (0.62), plain, in the caption colour; braces made harmless.
        assert!(bold.contains("\\N{\\fs43\\b0\\bord3\\shad0\\c&HFFFFFF&}Hola (ahí)."));
        let karaoke = to_ass(&paced, 1080, 1920, &look(Style::Karaoke));
        assert!(karaoke.contains("{\\k0}\\N{\\fs43"));
        let pop = to_ass(&paced, 1080, 1920, &look(Style::Pop));
        assert_eq!(
            pop.matches("Hola (ahí).").count(),
            pop.matches("Dialogue: ").count()
        );
        assert!(to_srt(&paced).contains("Hello there.\nHola {ahí}.\n\n"));
        // Through cut pauses and speed.
        let moved = speed_cues(
            &remap_cues(&[cue(vec![w(0.0, 1.0, "x")])], &[(0.0, 2.0)]),
            1.25,
        );
        assert_eq!(moved[0].translation, None);
        let parsed = parse(
            r#"{"cues":[{"start":0,"end":1,"text":"a","translation":"  b  "}],"style":"clean"}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(parsed.cues[0].translation.as_deref(), Some("b"));
    }

    #[test]
    fn subrip_carries_the_captions_as_drawn() {
        let paced = pace_cues(
            &[
                cue(vec![w(0.5, 1.0, "Hello"), w(1.0, 1.4, "there.")]),
                cue(vec![w(62.0, 62.5, "Later")]),
            ],
            Some(70.0),
        );
        assert_eq!(
            to_srt(&paced),
            "1\n00:00:00,420 --> 00:00:01,650\nHello there.\n\n2\n00:01:01,920 --> 00:01:02,750\nLater\n\n"
        );
    }

    #[test]
    fn both_providers_transcripts_become_words_on_the_source_clock() {
        // Cloudflare: words inside segments, punctuation included.
        let cloudflare = serde_json::json!({"text":"Hi, you.","transcription_info":{"language":"en"},"segments":[
            {"start":0.0,"end":1.0,"text":" Hi, you.","words":[{"word":"Hi,","start":0.0,"end":0.4},{"word":"you.","start":0.5,"end":0.9}]}]});
        let words = transcript_words(&cloudflare, 10.0);
        assert_eq!(words, vec![w(10.0, 10.4, "Hi,"), w(10.5, 10.9, "you.")]);
        assert_eq!(transcript_language(&cloudflare).as_deref(), Some("en"));
        // OpenRouter (OpenAI-style): words without punctuation take it from their segment when they line up.
        let openrouter = serde_json::json!({"language":"english","segments":[{"id":0,"start":0.0,"end":2.0,"text":"Well, okay."}],
            "words":[{"word":"Well","start":0.1,"end":0.5},{"word":"okay","start":0.6,"end":1.0},{"word":"[music]","start":1.0,"end":1.5,"type":"audio_event"}]});
        assert_eq!(
            transcript_words(&openrouter, 0.0),
            vec![w(0.1, 0.5, "Well,"), w(0.6, 1.0, "okay.")]
        );
        // No word times at all: the segment is spread over its span.
        let plain = serde_json::json!({"segments":[{"start":2.0,"end":4.0,"text":"ab cd"}]});
        assert_eq!(
            transcript_words(&plain, 0.0),
            vec![w(2.0, 3.0, "ab"), w(3.0, 4.0, "cd")]
        );
    }
}
