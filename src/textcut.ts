import { mergeSpans, type Span } from './polish';

/**
 * Editing a clip by its words (Descript's text editing; ClipCheap cuts a clip's own speech the same way): words taken
 * out of a clip in the transcript are kept as spans of the source clock, which the preview skips, the export cuts, and
 * the captions leave out. Spans, not word numbers, so a re-made transcript keeps them.
 */
type Word = { index: number; start: number; end: number };
/** A cut reaches this far past its words into the quiet around them, never into a kept word. */
const PAD = 0.02;

const middle = (word: Pick<Word, 'start' | 'end'>) => (word.start + word.end) / 2;

/** Whether a source time falls in one of the spans. */
export function inSpans(spans: readonly Span[], time: number) {
  return spans.some(([a, b]) => time >= a && time < b);
}

/** The clip's words that are cut: those whose middle lies in a cut span. */
export function cutWords(
  words: readonly Word[],
  removed: readonly Span[] | undefined,
): Set<number> {
  const cut = new Set<number>();
  if (!removed?.length) return cut;
  for (const word of words) if (inSpans(removed, middle(word))) cut.add(word.index);
  return cut;
}

/** The spans for a set of cut words among the clip's words (in time order): each run of them, padded into the quiet. */
export function spansOf(words: readonly Word[], cut: ReadonlySet<number>): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < words.length) {
    if (!cut.has(words[i].index)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < words.length && cut.has(words[j + 1].index)) j++;
    const before = words[i - 1]?.end ?? -Infinity;
    const after = words[j + 1]?.start ?? Infinity;
    spans.push([
      Math.round(Math.max(before, words[i].start - PAD) * 1000) / 1000,
      Math.round(Math.min(after, words[j].end + PAD) * 1000) / 1000,
    ]);
    i = j + 1;
  }
  return mergeSpans(spans);
}

/**
 * Cuts the words from `from` to `to` (word numbers, either way round), or restores them when every one is already cut.
 * Only the clip's own words count; the rest of its cuts stay as they were.
 */
export function toggleWords(
  words: readonly Word[],
  removed: readonly Span[] | undefined,
  from: number,
  to: number,
): Span[] {
  const [low, high] = from <= to ? [from, to] : [to, from];
  const run = words.filter((word) => word.index >= low && word.index <= high);
  if (!run.length) return [...(removed ?? [])];
  const cut = cutWords(words, removed);
  const restore = run.every((word) => cut.has(word.index));
  for (const word of run) {
    if (restore) cut.delete(word.index);
    else cut.add(word.index);
  }
  return spansOf(words, cut);
}

/** How much a clip's word cuts take out, in seconds. */
export function cutSeconds(removed: readonly Span[] | undefined) {
  return Math.round((removed ?? []).reduce((sum, [a, b]) => sum + (b - a), 0) * 10) / 10;
}
