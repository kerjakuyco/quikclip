import { readSaved } from './studio';

/**
 * What Highlight finder looks for (src-tauri highlights.rs SearchOptions): how many clips, and how long each may run.
 * Any count from 1 to 20; a length from the presets, or a range of your own from 5 seconds to 5 minutes.
 */
export const MAX_HIGHLIGHTS = 20;
export const SHORTEST_CLIP = 5;
export const LONGEST_CLIP = 300;
export const HIGHLIGHT_COUNTS = [1, 3, 5, 8, 12, 20] as const;
export const HIGHLIGHT_LENGTHS = [15, 30, 60, 90, 180] as const;
export type HighlightOptions = {
  count: number;
  maxSeconds: number;
  /** The shortest clip, for a range of your own. Absent lets the length decide (20 s, or half a short limit). */
  minSeconds?: number;
};
const KEY = 'highlightOptions';
const DEFAULTS: HighlightOptions = { count: 3, maxSeconds: 60 };

const whole = (n: unknown, low: number, high: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(high, Math.max(low, n))) : null;

/** Options as a search takes them: in bounds, with a minimum that leaves room under the maximum. */
export function cleanHighlightOptions(options: Partial<HighlightOptions>): HighlightOptions {
  const count = whole(options.count, 1, MAX_HIGHLIGHTS) ?? DEFAULTS.count;
  const maxSeconds =
    whole(options.maxSeconds, SHORTEST_CLIP * 2, LONGEST_CLIP) ?? DEFAULTS.maxSeconds;
  const min = whole(options.minSeconds, SHORTEST_CLIP, maxSeconds - SHORTEST_CLIP);
  return { count, maxSeconds, ...(min !== null ? { minSeconds: min } : {}) };
}

export function loadHighlightOptions(): HighlightOptions {
  return cleanHighlightOptions(readSaved<Partial<HighlightOptions>>(KEY, {}));
}

export function rememberHighlightOptions(options: HighlightOptions) {
  try {
    localStorage.setItem(`quikclip.1.${KEY}`, JSON.stringify(options));
  } catch {
    // The current search still uses the choices.
  }
}

/** An AI-suggested clip's editorial note (highlights.rs EditorialNote): its score, the parts of it, how it opens, why. */
export type Highlight = {
  score?: number;
  reason?: string;
  parts?: { hook: number; clarity: number; emotion: number; payoff: number };
  opening?: string;
};
/** A moment the search found (highlights.rs Pick): picked by the review, or a near-miss it turned down. */
export type Moment = {
  title: string;
  start: number;
  end: number;
  highlight: Highlight;
  hook?: string;
  approved: boolean;
};
