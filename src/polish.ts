/**
 * One-press edits from what a clip says (ClipCheap clip-clients lib/composition/polish.ts): its filler words cut, and
 * every other sentence punched in. Both read the transcript's timed words, on the source clock.
 */
type Word = { start: number; end: number; text: string };
export type Span = [number, number];

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'ah', 'hmm', 'mm', 'mhm']);
const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}']/gu, '');
const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** The punch-in zoom: media.rs PUNCH_ZOOM. */
export const PUNCH_ZOOM = 1.2;

export function isFiller(text: string) {
  return FILLERS.has(bare(text));
}

/** The words inside [start, end], in order. */
function spoken(words: readonly Word[], start: number, end: number) {
  return words
    .filter(
      (word) =>
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end > start &&
        word.start < end,
    )
    .sort((a, b) => a.start - b.start);
}

/** Spans in order, overlapping or touching ones (within 50 ms) joined. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const merged: Span[] = [];
  for (const [from, to] of [...spans].filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && from <= last[1] + 0.05) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

/**
 * The filler words of a clip as ranges to cut, on the source clock: each word with 20 ms either side, never into the
 * words around it, and joined when they touch (clip-clients `fillerRanges`).
 */
export function fillerRanges(words: readonly Word[], start: number, end: number): Span[] {
  const inside = spoken(words, start, end);
  const found: Span[] = [];
  inside.forEach((word, index) => {
    if (!isFiller(word.text)) return;
    const before = inside[index - 1]?.end ?? start;
    const after = inside[index + 1]?.start ?? end;
    found.push([
      round3(Math.max(start, before, word.start - 0.02)),
      round3(Math.min(end, after, word.end + 0.02)),
    ]);
  });
  return mergeSpans(found).filter(([a, b]) => b - a >= 0.05);
}

/** Where a clip's sentences start: after end punctuation or a breath, at least `gap` seconds apart and from its ends. */
export function sentenceStarts(words: readonly Word[], start: number, end: number, gap = 2.5) {
  const inside = spoken(words, start, end);
  const starts: number[] = [];
  let last = start;
  inside.forEach((word, index) => {
    const previous = inside[index - 1];
    const opens =
      previous && (/[.!?]["”']?$/.test(previous.text.trim()) || word.start - previous.end > 0.4);
    if (opens && word.start - last >= gap && end - word.start >= gap * 0.8) {
      starts.push(word.start);
      last = word.start;
    }
  });
  return starts;
}

/** Every other sentence of the clip, from the second, as the stretches shown punched in (on the source clock). */
export function punchRanges(words: readonly Word[], start: number, end: number): Span[] {
  const edges = [start, ...sentenceStarts(words, start, end), end];
  const zoomed: Span[] = [];
  for (let i = 1; i < edges.length - 1; i += 2)
    zoomed.push([round3(edges[i]), round3(edges[i + 1])]);
  return zoomed;
}

/** Spans moved to seconds from the clip's in point, as an export sends them. */
export function fromStart(spans: readonly Span[], start: number): Span[] {
  return spans.map(([a, b]) => [round3(a - start), round3(b - start)]);
}

export function spanSeconds(spans: readonly Span[]) {
  return round3(spans.reduce((sum, [a, b]) => sum + (b - a), 0));
}

/** Whether a source time is inside one of the spans. */
export function within(spans: readonly Span[], time: number) {
  return spans.some(([a, b]) => time >= a && time < b);
}

/** Whether someone is speaking at a source time (or within `slack` seconds of a word), for music that dips. */
export function speakingAt(words: readonly Word[], time: number, slack = 0.15) {
  return words.some((word) => time >= word.start - slack && time <= word.end + slack);
}
