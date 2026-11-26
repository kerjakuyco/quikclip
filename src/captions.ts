/**
 * Captions, cut and timed as clip-ai draws them (service/core.py) and clip-clients previews them
 * (src/lib/caption-timing.ts): the same rules run in the desktop export (src-tauri/src/captions.rs), so the preview shows
 * what the export burns in.
 * - lines (buildCues): up to 2 lines of about 32 columns and 3 seconds, broken at pauses and sentence ends, and at a
 *   clause once a line is mostly full; a one-word leftover is merged back or the break moved;
 * - pacing (paceCues): a little ahead of the voice, held through short pauses, long enough to read;
 * - styles: Bold highlights the word being said until the next one starts, Karaoke fills each word over its own spoken
 *   time and waits through pauses, Pop shows short groups with a box on the word being said.
 */
export type TimedText = { start: number; end: number; text: string };
export type Cue = {
  start: number;
  end: number;
  text: string;
  words: TimedText[];
  /** A second language under this line, when the clip shows both. */
  translation?: string;
};
export type CaptionStyle = 'bold' | 'clean' | 'karaoke' | 'pop' | 'none';
export type CaptionPosition = 'bottom' | 'middle' | 'top';

/**
 * A clip's captions: its look, and (only once its lines are changed by hand) its own words for [from, to] on the source
 * clock. Every other word comes from the project's transcript, so a fix there reaches every clip (clip-clients side-panel
 * CaptionsTab: "Use the transcript's lines" drops the clip's own).
 */
export type CutCaptions = {
  style: CaptionStyle;
  position: CaptionPosition;
  color: string;
  highlight: string;
  words?: TimedText[];
  from?: number;
  to?: number;
  /** This clip's lines in another language, matched to the source time they were spoken (`at`). */
  translation?: CaptionTranslation;
};

/** The languages captions translate into. The same codes and names reach the model (src-tauri translate.rs). */
export const TRANSLATE_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'pt', name: 'Portuguese (Brazil)' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'tl', name: 'Filipino' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese (Simplified)' },
] as const;
export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number]['code'];
export const languageName = (code: string) =>
  TRANSLATE_LANGUAGES.find((item) => item.code === code)?.name ?? code;

/** One translated line, kept at the source time of the caption it belongs to so a trim still finds it. */
export type TranslationLine = { at: number; line: string };
export type CaptionTranslation = {
  language: TranslateLanguage;
  both: boolean;
  lines: TranslationLine[];
};

/** A video's transcript on the source clock (src-tauri transcript.rs): Whisper's segments and timed words. */
export type Transcript = {
  language?: string | null;
  segments: TimedText[];
  words: TimedText[];
};
/** Corrections by word index in the transcript as read: the right text, or '' to drop the word. */
export type TranscriptFixes = Record<number, string>;

/** "Captions" is the plain word for the caption style burned into the video (clip-clients caption-style-picker). */
export const CAPTION_STYLES: { value: CaptionStyle; label: string; description: string }[] = [
  { value: 'bold', label: 'Bold', description: 'Capitals, the word being said lights up' },
  { value: 'clean', label: 'Clean', description: 'Calm text with a soft shadow' },
  { value: 'karaoke', label: 'Karaoke', description: 'Each word fills as it’s spoken' },
  { value: 'pop', label: 'Pop', description: 'A few words at a time, the spoken one boxed' },
  { value: 'none', label: 'Off', description: 'No text on the video' },
];
/** Quikclip's twelve caption colours: the studio's ember, sage and graphite (studio.css --accent, --green, --bg) with
 *  colours that hold up over video. Captions are white with an ember highlight unless a clip picks others. */
export const CAPTION_COLORS = [
  { value: '#FFFFFF', label: 'White' },
  { value: '#FF8057', label: 'Ember' },
  { value: '#FFD166', label: 'Sun' },
  { value: '#93C4A2', label: 'Sage' },
  { value: '#5EE2C4', label: 'Mint' },
  { value: '#4CC9F0', label: 'Sky' },
  { value: '#7B93FF', label: 'Cobalt' },
  { value: '#B69CFF', label: 'Iris' },
  { value: '#FF8CC6', label: 'Rose' },
  { value: '#FF5A5F', label: 'Signal' },
  { value: '#F3E6D3', label: 'Cream' },
  { value: '#121315', label: 'Graphite' },
] as const;
export const TEXT_COLOR = '#FFFFFF';
export const HIGHLIGHT_COLOR = '#FF8057';
export const CAPTION_POSITIONS: { value: CaptionPosition; label: string }[] = [
  { value: 'bottom', label: 'Bottom' },
  { value: 'middle', label: 'Middle' },
  { value: 'top', label: 'Top' },
];
/** Styles that colour the spoken word: Bold's word, Karaoke's fill and Pop's box. */
export const hasHighlight = (style: CaptionStyle) =>
  style === 'bold' || style === 'karaoke' || style === 'pop';

export const MAX_LINE = 32;
export const MAX_LINES = 2;
export const MAX_CUE_SECONDS = 3;
export const PAUSE_SECONDS = 0.6;
const HOLD_SECONDS = 0.4;
export const CAPTION_LEAD = 0.08;
export const CAPTION_LINGER = 0.25;
export const CAPTION_BRIDGE = 0.5;
export const CAPTION_MIN = 0.8;
const MIN_WORD_SECONDS = 0.06;
const POP_WIDTH = 18;
const POP_PAUSE = 0.35;

const SENTENCE_END = ['.', '!', '?', '…', '。', '！', '？'];
const CLAUSE_END = [',', ';', ':', '、', '，', '；', '：'];
const CLOSING = new Set([...'"\')]»”’」』）']);

const round = (value: number) => Math.round(value * 1000) / 1000;
const codePoint = (char: string) => char.codePointAt(0) ?? 0;
const hangul = (char: string) => {
  const c = codePoint(char);
  return (
    (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f) || (c >= 0xac00 && c <= 0xd7af)
  );
};
/** East Asian wide and full-width characters (and emoji), which take two columns. */
function wide(char: string) {
  const c = codePoint(char);
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0x303e) ||
    (c >= 0x3041 && c <= 0x33ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xa000 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1f64f) ||
    (c >= 0x1f900 && c <= 0x1f9ff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  );
}
const emoji = (char: string) => {
  const c = codePoint(char);
  return (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f900 && c <= 0x1f9ff);
};
/** Scripts written without spaces (Han, kana); Hangul and emoji use spaces. Matches captions.rs `cjk`. */
const cjk = (char: string) => wide(char) && !hangul(char) && !emoji(char);
export const displayWidth = (text: string) =>
  [...text].reduce((sum, char) => sum + (wide(char) ? 2 : 1), 0);
const spaced = (left: string, right: string) =>
  !(cjk([...left].at(-1) ?? '') || cjk([...right][0] ?? ''));
export function joinWords(texts: string[]) {
  let out = '';
  for (const text of texts)
    if (text) out = out && spaced(out, text) ? `${out} ${text}` : out + text;
  return out;
}
function ends(text: string, marks: string[]) {
  const chars = [...text];
  while (chars.length && CLOSING.has(chars[chars.length - 1])) chars.pop();
  const trimmed = chars.join('');
  return marks.some((mark) => trimmed.endsWith(mark));
}

/** The lines a caption's words wrap to (index ranges): a balanced two-line split when it fits, preferring punctuation. */
export function wrapRanges(texts: string[], width = MAX_LINE): [number, number][] {
  const count = texts.length;
  if (count < 2 || displayWidth(joinWords(texts)) <= width) return count ? [[0, count]] : [];
  let best: [number, number] | null = null;
  for (let k = 1; k < count; k++) {
    const top = displayWidth(joinWords(texts.slice(0, k))),
      bottom = displayWidth(joinWords(texts.slice(k)));
    if (top <= width && bottom <= width) {
      const score =
        Math.max(top, bottom) - (ends(texts[k - 1], [...SENTENCE_END, ...CLAUSE_END]) ? 6 : 0);
      if (!best || score < best[0]) best = [score, k];
    }
  }
  if (best)
    return [
      [0, best[1]],
      [best[1], count],
    ];
  const ranges: [number, number][] = [];
  let first = 0;
  for (let index = 1; index < count; index++) {
    if (displayWidth(joinWords(texts.slice(first, index + 1))) > width) {
      ranges.push([first, index]);
      first = index;
    }
  }
  return [...ranges, [first, count]];
}

const textsOf = (words: TimedText[]) => words.map((word) => word.text);
function cueBreak(current: TimedText[], word: TimedText) {
  const last = current[current.length - 1];
  const texts = [...textsOf(current), word.text];
  if (word.start - last.end >= PAUSE_SECONDS || word.end - current[0].start > MAX_CUE_SECONDS)
    return true;
  if (ends(last.text, SENTENCE_END) || wrapRanges(texts).length > MAX_LINES) return true;
  // Break at a clause once the cue already fills most of a line, rather than mid-phrase later.
  return (
    ends(last.text, CLAUSE_END) && displayWidth(joinWords(texts.slice(0, -1))) >= MAX_LINE * 0.6
  );
}
const fits = (words: TimedText[]) =>
  words[words.length - 1].end - words[0].start <= MAX_CUE_SECONDS &&
  wrapRanges(textsOf(words)).length <= MAX_LINES;
const width = (words: TimedText[]) => displayWidth(joinWords(textsOf(words)));

/** A one-word cue left by a forced break reads as an orphan: merge it back when that fits, else move the break earlier. */
function rebalance(groups: TimedText[][]) {
  const result: TimedText[][] = [];
  for (const group of groups) {
    const previous = result[result.length - 1];
    if (
      !previous ||
      group.length > 1 ||
      previous.length < 2 ||
      group[0].start - previous[previous.length - 1].end >= PAUSE_SECONDS ||
      ends(previous[previous.length - 1].text, SENTENCE_END)
    ) {
      result.push(group);
      continue;
    }
    const merged = [...previous, ...group];
    const splits: number[] = [];
    for (let k = 1; k < merged.length - 1; k++)
      if (fits(merged.slice(0, k)) && fits(merged.slice(k))) splits.push(k);
    if (fits(merged)) result[result.length - 1] = merged;
    else if (splits.length) {
      const key = (k: number): [number, number, number] => [
        ends(merged[k - 1].text, [...SENTENCE_END, ...CLAUSE_END]) ? 0 : 1,
        merged[k].start - merged[k - 1].end < 0.25 ? 1 : 0,
        Math.max(width(merged.slice(0, k)), width(merged.slice(k))),
      ];
      const k = splits.reduce((best, next) => {
        const [a, b] = [key(next), key(best)];
        return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))
          ? next
          : best;
      });
      result.splice(result.length - 1, 1, merged.slice(0, k), merged.slice(k));
    } else result.push(group);
  }
  return result;
}

function makeCue(words: TimedText[]): Cue {
  const start = words[0].start;
  const end = Math.min(words[words.length - 1].end, start + MAX_CUE_SECONDS);
  return {
    start: round(start),
    end: round(end),
    text: joinWords(textsOf(words)),
    words: words.map((word) => ({
      start: round(Math.min(word.start, end)),
      end: round(Math.min(word.end, end)),
      text: word.text,
    })),
  };
}

/** A clip's captions cut from the transcript's words (source seconds) into clip-relative cues, as clip-ai cuts them. */
export function buildCues(words: TimedText[], start: number, end: number): Cue[] {
  const clip = words
    .filter((word) => word.end > start && word.start < end && word.text.trim())
    .map((word) => ({
      start: Math.max(start, word.start) - start,
      end: Math.min(end, word.end) - start,
      text: word.text.trim(),
    }));
  const groups: TimedText[][] = [];
  let current: TimedText[] = [];
  for (const word of clip) {
    if (current.length && cueBreak(current, word)) {
      groups.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length) groups.push(current);
  const cues = rebalance(groups).map(makeCue);
  // Hold each cue briefly into the following pause, never past the next cue.
  return cues.flatMap((cue, index) => {
    const following = cues[index + 1];
    const cueEnd = round(
      Math.min(
        cue.end + HOLD_SECONDS,
        cue.start + MAX_CUE_SECONDS,
        following ? following.start : end - start,
      ),
    );
    if (cueEnd - cue.start < 0.05) return [];
    return [
      {
        ...cue,
        end: cueEnd,
        words: cue.words.map((word) => ({
          ...word,
          start: Math.min(word.start, cueEnd),
          end: Math.min(word.end, cueEnd),
        })),
      },
    ];
  });
}

/** A cue's words, in order and inside it, `shift` seconds earlier, each with some length where the next word leaves room. */
export function tidyWords(words: TimedText[], start: number, end: number, shift = 0): TimedText[] {
  const ordered = words.filter((word) => word.text.trim()).sort((a, b) => a.start - b.start);
  let previous = start;
  return ordered.map((word, index) => {
    const next = ordered[index + 1];
    const following = next ? Math.min(Math.max(next.start - shift, start), end) : end;
    const begin = Math.min(Math.max(word.start - shift, previous, start), end);
    const finish = Math.min(
      Math.max(word.end - shift, begin + MIN_WORD_SECONDS),
      Math.max(following, begin),
      end,
    );
    previous = begin;
    return { ...word, start: round(begin), end: round(Math.max(finish, begin)) };
  });
}

/** Word timing proportional to word length: the fallback when a cue has no word timestamps. */
export function proportionalWords(text: string, start: number, end: number): TimedText[] {
  const words = text.split(/\s+/).filter(Boolean);
  const total = words.reduce((sum, word) => sum + word.length, 0);
  let cursor = start;
  return words.map((word, index) => {
    const wordEnd =
      index === words.length - 1 ? end : cursor + ((end - start) * word.length) / total;
    const timed = { start: round(cursor), end: round(wordEnd), text: word };
    cursor = wordEnd;
    return timed;
  });
}

export type PacedCue = Cue & { fade_in: boolean; fade_out: boolean };
/** Cues as drawn: a little ahead of the voice, held through short pauses, long enough to read, never overlapping. */
export function paceCues(cues: Cue[], duration?: number): PacedCue[] {
  const ordered = cues.filter((cue) => cue.end > cue.start).sort((a, b) => a.start - b.start);
  const first = (cue: Cue) => Math.min(cue.start, ...cue.words.map((word) => word.start));
  const paced: PacedCue[] = [];
  ordered.forEach((cue, index) => {
    const previous = paced.length ? paced[paced.length - 1].end : 0;
    const start = Math.max(first(cue) - CAPTION_LEAD, previous, 0);
    const next = ordered[index + 1];
    const limit = next
      ? Math.max(first(next) - CAPTION_LEAD, start)
      : duration !== undefined
        ? Math.max(duration, start)
        : undefined;
    let end = cue.end + CAPTION_LINGER;
    if (limit !== undefined && limit - end < CAPTION_BRIDGE) end = limit;
    end = Math.max(end, start + CAPTION_MIN);
    if (limit !== undefined) end = Math.min(end, limit);
    if (end - start < 0.05) return;
    const words = cue.words.length
      ? tidyWords(cue.words, start, end, CAPTION_LEAD)
      : proportionalWords(cue.text, start, end);
    paced.push({
      ...cue,
      start: round(start),
      end: round(end),
      words,
      fade_in: !paced.length || start - previous > 0.01,
      fade_out: true,
    });
  });
  paced.forEach((cue, index) => {
    const next = paced[index + 1];
    cue.fade_out = !next || next.start - cue.end > 0.01;
  });
  return paced;
}

/** Pop's groups: up to three words and 18 columns, broken after punctuation and at a pause. */
export function popGroups<T extends TimedText>(words: T[]): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  for (const word of words) {
    const last = current[current.length - 1];
    if (
      last &&
      (current.length === 3 ||
        displayWidth(joinWords([...textsOf(current), word.text])) > POP_WIDTH ||
        ends(last.text, [...SENTENCE_END, ...CLAUSE_END]) ||
        word.start - last.end >= POP_PAUSE)
    ) {
      groups.push(current);
      current = [];
    }
    current.push(word);
  }
  return current.length ? [...groups, current] : groups;
}

/**
 * What a cue shows at `time` (the same clock as its words): the word being said (from its start until the next word's;
 * the first from the cue's start, as Bold and Pop draw it), how far Karaoke has filled each word, and Pop's group.
 */
export function captionMoment(cue: Cue, time: number) {
  const words = cue.words.length ? cue.words : proportionalWords(cue.text, cue.start, cue.end);
  let said = -1;
  words.forEach((word, index) => {
    if (time >= word.start) said = index;
  });
  const active = Math.max(0, said);
  const fill = words.map((word, index) => {
    const next = words[index + 1]?.start ?? cue.end;
    const end = Math.max(word.start, Math.min(word.end, next));
    if (time >= end) return 1;
    if (time <= word.start) return 0;
    return (time - word.start) / Math.max(end - word.start, 0.001);
  });
  const groups = popGroups(words.map((word, index) => ({ ...word, index })));
  const group =
    groups.find((items) => items.some((item) => item.index === active)) ?? groups[0] ?? [];
  return { words, active, fill, group, groupIndex: groups.indexOf(group) };
}

function srtTime(seconds: number) {
  const total = Math.round(Math.max(0, seconds) * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(Math.floor(total / 3600000))}:${pad(Math.floor(total / 60000) % 60)}:${pad(
    Math.floor(total / 1000) % 60,
  )},${pad(total % 1000, 3)}`;
}

/** Cues as SubRip, timed as drawn, lines wrapped as drawn (clip-ai to_srt; captions.rs to_srt for exports). */
export function toSrt(cues: PacedCue[]) {
  return cues
    .map((cue, index) => {
      const texts = cue.words.map((w) => w.text);
      const lines = wrapRanges(texts).map(([a, b]) => joinWords(texts.slice(a, b)));
      const translation = cue.translation ? `\n${cue.translation}` : '';
      return `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${lines.join('\n')}${translation}\n`;
    })
    .join('\n');
}

/** The transcript as plain text: a timestamp and a sentence or phrase per line. */
export function transcriptText(title: string, lines: TranscriptLine[]) {
  const stamp = (seconds: number) => {
    const s = Math.floor(seconds);
    const [h, m, r] = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60];
    return h
      ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
      : `${m}:${String(r).padStart(2, '0')}`;
  };
  const body = lines.map(
    (line) => `[${stamp(line.start)}] ${joinWords(line.words.map((w) => w.text))}`,
  );
  return `${title}\n\n${body.join('\n')}\n`;
}

/** A BCP 47 tag from Whisper's language ("en" or "english"), for the captions' `lang`: it picks the regional CJK face. */
export function languageTag(language: string | null | undefined) {
  const value = (language ?? '').trim().toLowerCase();
  const names: Record<string, string> = {
    chinese: 'zh',
    mandarin: 'zh',
    cantonese: 'zh',
    japanese: 'ja',
    korean: 'ko',
    english: 'en',
  };
  if (/^[a-z]{2}(-|$)/.test(value)) return value.slice(0, 2);
  return names[value] ?? undefined;
}

/** sRGB relative luminance under 0.2: only near-black needs a light outline (clip-ai is_dark). */
export function isDark(color: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(color.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.2;
}
const known = (color: unknown, fallback: string) =>
  CAPTION_COLORS.find((option) => option.value === String(color ?? '').toUpperCase())?.value ??
  fallback;

const LINE_NEAR = 0.08;
function cleanLine(line: string, limit: number) {
  const text = line.replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit).replace(/\s+\S*$/u, '');
  return (cut || text.slice(0, limit)).trim();
}
function ownTranslation(value: unknown): CaptionTranslation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as { language?: unknown; both?: unknown; lines?: unknown };
  const language = TRANSLATE_LANGUAGES.find((item) => item.code === raw.language)?.code;
  if (!language || !Array.isArray(raw.lines)) return undefined;
  const lines = raw.lines
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const at = (item as { at?: unknown }).at;
      const line = (item as { line?: unknown }).line;
      if (typeof at !== 'number' || !Number.isFinite(at) || typeof line !== 'string') return [];
      const text = cleanLine(line, 300);
      return text ? [{ at, line: text }] : [];
    })
    .slice(0, 400);
  return lines.length ? { language, both: raw.both === true, lines } : undefined;
}

const finite = (start: unknown, end: unknown) =>
  typeof start === 'number' &&
  typeof end === 'number' &&
  Number.isFinite(start) &&
  Number.isFinite(end) &&
  end >= start;

const ownWords = (words: unknown): TimedText[] | undefined =>
  Array.isArray(words)
    ? words
        .filter((w) => finite(w?.start, w?.end) && typeof w.text === 'string' && w.text.trim())
        .map((w) => ({ start: w.start, end: w.end, text: w.text.trim().slice(0, 64) }))
    : undefined;

/** A clip's captions as they show: Bold at the bottom, white with an ember highlight, unless the clip chose otherwise. */
export function cutCaptions(cut: { captions?: Partial<CutCaptions> | null }): CutCaptions {
  const c = cut.captions ?? {};
  const words = ownWords(c.words);
  const own = words && finite(c.from, c.to);
  const translation = ownTranslation(c.translation);
  return {
    style: CAPTION_STYLES.some((s) => s.value === c.style) ? (c.style as CaptionStyle) : 'bold',
    position: CAPTION_POSITIONS.some((p) => p.value === c.position)
      ? (c.position as CaptionPosition)
      : 'bottom',
    color: known(c.color, TEXT_COLOR),
    highlight: known(c.highlight, HIGHLIGHT_COLOR),
    ...(own ? { words, from: c.from, to: c.to } : {}),
    ...(translation ? { translation } : {}),
  };
}

/** The translated line spoken at `at` on the source clock, if this clip has one. */
export function translationAt(lines: TranslationLine[], at: number) {
  return lines.find((item) => Math.abs(item.at - at) < LINE_NEAR)?.line;
}

/**
 * Cues as they show and export (clip-clients translatedCues): under the original line, or in its place with the words
 * spread over the same time. A line with no translation stays as the transcript said it.
 */
export function presentCues(
  cues: Cue[],
  translation: CaptionTranslation | undefined,
  origin: number,
): Cue[] {
  if (!translation) return cues;
  return cues.map((cue) => {
    const line = translationAt(translation.lines, origin + cue.start);
    if (!line) return { ...cue, translation: undefined };
    if (translation.both) return { ...cue, translation: line };
    const text = cleanLine(line, 200);
    return {
      ...cue,
      text,
      words: proportionalWords(text, cue.start, cue.end),
      translation: undefined,
    };
  });
}

/** One translated line replaced or cleared. `at` is its time on the source clock. */
export function writeTranslationLine(captions: CutCaptions, at: number, line: string): CutCaptions {
  const current = captions.translation;
  if (!current) return captions;
  const text = cleanLine(line, 300);
  const lines = current.lines.filter((item) => Math.abs(item.at - at) >= LINE_NEAR);
  if (text) lines.push({ at, line: text });
  lines.sort((a, b) => a.at - b.at);
  return { ...captions, translation: { ...current, lines } };
}

/** The translation dropped: the clip's captions are the transcript's language again. */
export function clearTranslation(captions: CutCaptions): CutCaptions {
  const { translation: _drop, ...rest } = captions;
  return rest;
}

/** The transcript's words with the project's corrections: a fixed word keeps its time, an emptied one goes. */
export function correctedWords(
  words: TimedText[],
  fixes: TranscriptFixes | undefined,
): TimedText[] {
  if (!fixes || !Object.keys(fixes).length) return words;
  return words.flatMap((word, index) => {
    const fix = fixes[index];
    if (fix === undefined) return [word];
    const text = fix.replace(/\s+/g, ' ').trim();
    return text ? [{ ...word, text }] : [];
  });
}

/** The words a clip's captions are cut from: the transcript's, with the clip's own lines in their place where it has them. */
export function captionWords(transcript: TimedText[], captions: CutCaptions): TimedText[] {
  if (!captions.words || captions.from === undefined || captions.to === undefined)
    return transcript;
  const [from, to] = [captions.from, captions.to];
  const middle = (w: TimedText) => (w.start + w.end) / 2;
  return [...transcript.filter((w) => middle(w) < from || middle(w) > to), ...captions.words].sort(
    (a, b) => a.start - b.start,
  );
}

/**
 * A cue's text edited in place (clip-clients editCueText): the cue keeps its time; the words are spread over it. The clip
 * then keeps its own lines for its range [`start`, `end`] on the source clock; `words` are the ones its cues came from.
 */
export function editCue(
  captions: CutCaptions,
  words: TimedText[],
  cue: Cue,
  text: string,
  start: number,
  end: number,
): CutCaptions {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized === joinWords(cue.words.map((w) => w.text))) return captions;
  const [from, to] = [start + cue.start, start + cue.end];
  const middle = (w: TimedText) => (w.start + w.end) / 2;
  const kept = words.filter(
    (w) =>
      middle(w) >= start &&
      middle(w) <= end &&
      (middle(w) < from - 0.001 || middle(w) > to + 0.001),
  );
  const own = [...kept, ...proportionalWords(normalized, from, to)].sort(
    (a, b) => a.start - b.start,
  );
  return { ...captions, words: own, from: start, to: end };
}

/** The clip's own lines dropped: its captions come from the transcript again. */
export function transcriptLines(captions: CutCaptions): CutCaptions {
  return {
    style: captions.style,
    position: captions.position,
    color: captions.color,
    highlight: captions.highlight,
  };
}

export type IndexedWord = TimedText & { index: number };
export type TranscriptLine = { start: number; end: number; words: IndexedWord[] };

/**
 * The transcript as lines for reading (clip-clients transcriptLines): one per Whisper segment, holding the words whose middle
 * falls inside it, each with its index in the transcript as read (corrections are kept by that index).
 */
export function readingLines(
  transcript: Transcript,
  fixes: TranscriptFixes | undefined,
): TranscriptLine[] {
  const words: IndexedWord[] = transcript.words.map((word, index) => ({
    ...word,
    index,
    text: fixes?.[index] ?? word.text,
  }));
  const lines: TranscriptLine[] = [];
  let next = 0;
  const segments = transcript.segments.length
    ? transcript.segments
    : words.length
      ? [{ start: words[0].start, end: words[words.length - 1].end, text: '' }]
      : [];
  for (const segment of segments) {
    const own: IndexedWord[] = [];
    while (next < words.length && (words[next].start + words[next].end) / 2 <= segment.end + 0.05) {
      own.push(words[next]);
      next += 1;
    }
    if (own.length) lines.push({ start: segment.start, end: segment.end, words: own });
  }
  if (next < words.length) {
    const rest = words.slice(next);
    lines.push({ start: rest[0].start, end: rest[rest.length - 1].end, words: rest });
  }
  return lines;
}

/** clip-ai CAPTION_SIZES (ASS points at a 1080 px short side) and margins (share of height: line styles, Pop). */
const CAPTION_SIZES = {
  vertical: { clean: 66, bold: 70, karaoke: 70, pop: 104 },
  square: { clean: 62, bold: 66, karaoke: 66, pop: 96 },
  wide: { clean: 62, bold: 66, karaoke: 66, pop: 90 },
} as const;
const CAPTION_MARGINS = {
  vertical: [0.24, 0.3],
  square: [0.09, 0.18],
  wide: [0.08, 0.14],
} as const;
const CAPTION_TOP = { vertical: 0.14, square: 0.09, wide: 0.08 } as const;
const aspectOf = (width: number, height: number) =>
  height > width ? 'vertical' : height === width ? 'square' : 'wide';

/** Caption size and placement for a `width` × `height` frame, as the export draws them (captions.rs to_ass). */
export function captionMetrics(
  width: number,
  height: number,
  style: Exclude<CaptionStyle, 'none'>,
) {
  const aspect = aspectOf(width, height);
  const size = (CAPTION_SIZES[aspect][style] * Math.min(width, height)) / 1080;
  return {
    /** Font size in pixels of the frame. */
    size,
    /** Bottom margin as a share of the height. */
    bottom: CAPTION_MARGINS[aspect][style === 'pop' ? 1 : 0],
    /** Where captions on Top start, as a share of the height, when no headline sits there. */
    top: CAPTION_TOP[aspect],
  };
}

/**
 * Where captions on Top start under a headline, in pixels of the frame (clip-ai to_ass: the headline box's bottom plus a
 * gap). `headlineBottom` is that box's bottom edge in pixels, or null without a headline.
 */
export function captionTop(
  width: number,
  height: number,
  style: Exclude<CaptionStyle, 'none'>,
  headlineBottom: number | null,
  headlineSize: number,
) {
  const metrics = captionMetrics(width, height, style);
  if (headlineBottom === null) return Math.round(height * metrics.top);
  return Math.round(headlineBottom + Math.max(metrics.size, headlineSize) * 0.35);
}
