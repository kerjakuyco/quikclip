//! Text on the video (ClipCheap's text layers, clip-ai compose.py TEXT_PRESETS): titles, labels, quotes and calls to
//! action placed anywhere in the frame for a stretch of the clip, appearing with a fade, a pop, a slide, or typed out.
//! Drawn as their own ASS script, over the captions. The studio previews them the same way (src/texts.ts).
use crate::captions::{ass_colour, ass_text, ass_time, FONT};
use crate::media::Result;
use serde::Deserialize;

/// The most text layers on one clip.
pub const MAX_TEXTS: usize = 8;
const MAX_CHARS: usize = 160;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRequest {
    pub text: String,
    pub preset: String,
    /// Seconds from the clip's in point, on the source clock.
    pub at: f64,
    pub length: f64,
    /// Where its centre sits, as a share of the frame, 0–1.
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub animation: String,
    #[serde(default)]
    pub color: String,
}

/// A text layer on the exported clock.
pub struct Shown {
    pub request: TextRequest,
    pub start: f64,
    pub end: f64,
}

/// Size as a share of the frame's short side, bold, italic, and whether it sits on a box (clip-ai TEXT_PRESETS).
fn preset(name: &str) -> Result<(f64, bool, bool, bool)> {
    Ok(match name {
        "title" => (0.085, true, false, false),
        "subtitle" => (0.055, true, false, false),
        "label" => (0.045, true, false, true),
        "quote" => (0.06, false, true, false),
        "cta" => (0.058, true, false, true),
        _ => return Err("Unknown text style.".into()),
    })
}

/// The text checked: one of the presets, an animation the studio knows, and plain text of a sensible length.
pub fn check(item: &TextRequest) -> Result<()> {
    preset(&item.preset)?;
    if !matches!(
        item.animation.as_str(),
        "" | "none" | "fade" | "pop" | "slide" | "type"
    ) {
        return Err("Unknown text animation.".into());
    }
    if ![item.at, item.length, item.x, item.y]
        .iter()
        .all(|n| n.is_finite())
        || item.length < 0.2
    {
        return Err("A text layer needs a start and a length of at least 0.2 seconds.".into());
    }
    if item.text.trim().is_empty() || item.text.chars().count() > MAX_CHARS {
        return Err("Text layers hold 1 to 160 characters.".into());
    }
    Ok(())
}

fn colour(text: &str) -> String {
    let hex = text.trim_start_matches('#');
    if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        format!("#{hex}")
    } else {
        "#FFFFFF".into()
    }
}

/// Seconds a typed-out text takes per character.
const TYPE_STEP: f64 = 0.045;

/// The ASS script drawing every text layer at `width` × `height`.
pub fn texts_ass(items: &[Shown], width: u32, height: u32) -> Result<String> {
    let short = f64::from(width.min(height));
    let mut styles = Vec::new();
    let mut events = Vec::new();
    for (index, shown) in items.iter().enumerate() {
        let item = &shown.request;
        let (size, bold, italic, boxed) = preset(&item.preset)?;
        let font = (short * size).round().max(8.0);
        let fill = colour(&item.color);
        // A box behind labels and calls to action; an outline and soft shadow otherwise.
        let (border, outline, shadow, back) = if boxed {
            (3, (font * 0.28).round(), 0.0, ass_colour("#121315", 0x30))
        } else {
            (
                1,
                (font * 0.06).round().max(1.0),
                (font * 0.05).round(),
                ass_colour("#000000", 0x80),
            )
        };
        let name = format!("T{index}");
        styles.push(format!(
            "Style: {name},{FONT},{font},{},{},{},{back},{},{},0,0,100,100,0,0,{border},{outline},{shadow},5,0,0,0,1",
            ass_colour(&fill, 0),
            ass_colour(&fill, 0),
            ass_colour("#121315", if boxed { 0x30 } else { 0x20 }),
            if bold { -1 } else { 0 },
            if italic { -1 } else { 0 },
        ));
        let x = (item.x.clamp(0.0, 1.0) * f64::from(width)).round();
        let y = (item.y.clamp(0.0, 1.0) * f64::from(height)).round();
        let text = ass_text(item.text.trim()).replace('\n', "\\N");
        let line = |start: f64, end: f64, tags: &str, body: &str| {
            format!(
                "Dialogue: 1,{},{},{name},,0,0,0,,{{\\an5{tags}}}{body}",
                ass_time(start),
                ass_time(end)
            )
        };
        let (start, end) = (shown.start, shown.end);
        match item.animation.as_str() {
            "fade" => events.push(line(start, end, &format!("\\pos({x},{y})\\fad(250,250)"), &text)),
            "pop" => events.push(line(
                start,
                end,
                &format!(
                    "\\pos({x},{y})\\fscx60\\fscy60\\t(0,180,\\fscx108\\fscy108)\\t(180,280,\\fscx100\\fscy100)\\fad(120,200)"
                ),
                &text,
            )),
            "slide" => {
                let from = y + (f64::from(height) * 0.05).round();
                events.push(line(
                    start,
                    end,
                    &format!("\\move({x},{from},{x},{y},0,300)\\fad(200,200)"),
                    &text,
                ));
            }
            "type" => {
                // One line per letter shown so far; the rest is laid out but clear, so nothing moves as it types.
                let letters: Vec<char> = item.text.trim().chars().collect();
                let typed = (end - start - 0.3).max(0.1);
                let step = TYPE_STEP.min(typed / letters.len().max(1) as f64);
                for count in 1..=letters.len() {
                    let at = start + step * (count - 1) as f64;
                    let until = if count == letters.len() { end } else { start + step * count as f64 };
                    let shown: String = letters[..count].iter().collect();
                    let hidden: String = letters[count..].iter().collect();
                    let body = format!(
                        "{}{{\\alpha&HFF&}}{}",
                        ass_text(&shown).replace('\n', "\\N"),
                        ass_text(&hidden).replace('\n', "\\N")
                    );
                    events.push(line(at, until, &format!("\\pos({x},{y})"), &body));
                }
            }
            _ => events.push(line(start, end, &format!("\\pos({x},{y})"), &text)),
        }
    }
    Ok(format!(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n\
         [V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n{}\n\n\
         [Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n{}\n",
        styles.join("\n"),
        events.join("\n")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer(animation: &str, preset: &str) -> Shown {
        Shown {
            request: TextRequest {
                text: "Hi {you}".into(),
                preset: preset.into(),
                at: 1.0,
                length: 2.0,
                x: 0.5,
                y: 0.25,
                animation: animation.into(),
                color: "#FFD166".into(),
            },
            start: 1.0,
            end: 3.0,
        }
    }

    #[test]
    fn text_layers_are_checked_and_drawn_where_they_belong() {
        assert!(check(&layer("pop", "cta").request).is_ok());
        assert!(check(&layer("spin", "cta").request).is_err());
        assert!(check(&layer("fade", "huge").request).is_err());
        let script =
            texts_ass(&[layer("fade", "title"), layer("pop", "label")], 1080, 1920).unwrap();
        assert!(script.contains("Style: T0,Noto Sans,92,&H0066D1FF"));
        // Labels sit on a box.
        assert!(script.contains("Style: T1,Noto Sans,49,") && script.contains(",3,14,0,5,"));
        assert!(script.contains(
            "Dialogue: 1,0:00:01.00,0:00:03.00,T0,,0,0,0,,{\\an5\\pos(540,480)\\fad(250,250)}"
        ));
        assert!(script.contains("\\t(0,180,\\fscx108\\fscy108)"));
        // Braces in the text never become tags.
        assert!(!script.contains("{you}"));
        let typed = texts_ass(&[layer("type", "quote")], 1080, 1920).unwrap();
        assert_eq!(
            typed.matches("Dialogue:").count(),
            "Hi {you}".chars().count()
        );
        assert!(typed.contains("{\\alpha&HFF&}"));
    }
}
