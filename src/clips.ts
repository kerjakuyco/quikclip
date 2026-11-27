import type { Cut } from './studio';

/** Length bands from ClipCheap's moment list: any, under 30 s, 30–60 s, and longer. */
export const CLIP_LENGTHS = [
  ['any', 'Any length'],
  ['short', 'Under 30 s'],
  ['medium', '30–60 s'],
  ['long', 'Over 60 s'],
] as const;
export type ClipLength = (typeof CLIP_LENGTHS)[number][0];

export type SpokenBit = { start: number; end: number; text: string };

export function clipSeconds(cut: Pick<Cut, 'start' | 'end'>) {
  return Math.max(0, cut.end - cut.start);
}

export function clipLengthBand(seconds: number): Exclude<ClipLength, 'any'> {
  if (seconds < 30) return 'short';
  if (seconds <= 60) return 'medium';
  return 'long';
}

const BANDS = ['short', 'medium', 'long'] as const;

/**
 * Where a length falls inside its band, 0–1, for the clip bin's length ruler. The last band has no end, so it runs to
 * the longest clip, and to at least two minutes so one long clip doesn't sit at the far end.
 */
export function lengthSpot(seconds: number, longest = seconds) {
  const band = clipLengthBand(seconds);
  const [from, to] =
    band === 'short' ? [0, 30] : band === 'medium' ? [30, 60] : [60, Math.max(120, longest)];
  return Math.min(1, Math.max(0, (seconds - from) / (to - from)));
}

/** The same spot on the whole ruler, where each band takes a third. */
export function rulerSpot(seconds: number, longest = seconds) {
  return (BANDS.indexOf(clipLengthBand(seconds)) + lengthSpot(seconds, longest)) / 3;
}

/** A clip matches when every word appears in its name, suggestion note, or speech inside the range. */
export function clipMatches(
  cut: Pick<Cut, 'title' | 'start' | 'end' | 'highlight'>,
  text: string,
  length: ClipLength,
  spoken: readonly SpokenBit[] = [],
) {
  if (length !== 'any' && clipLengthBand(clipSeconds(cut)) !== length) return false;
  const terms = text.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = [
    cut.title,
    cut.highlight?.reason ?? '',
    ...spoken
      .filter((word) => word.end > cut.start && word.start < cut.end)
      .map((word) => word.text),
  ]
    .join(' ')
    .toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}
