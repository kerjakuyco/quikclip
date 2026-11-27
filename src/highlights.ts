import { readSaved } from './studio';

export const HIGHLIGHT_COUNTS = [1, 3, 5, 8] as const;
export const HIGHLIGHT_LENGTHS = [30, 60, 90] as const;
export type HighlightOptions = {
  count: (typeof HIGHLIGHT_COUNTS)[number];
  maxSeconds: (typeof HIGHLIGHT_LENGTHS)[number];
};
const KEY = 'highlightOptions';
const DEFAULTS: HighlightOptions = { count: 3, maxSeconds: 60 };

export function loadHighlightOptions(): HighlightOptions {
  const saved = readSaved<Partial<HighlightOptions>>(KEY, {});
  return {
    count: HIGHLIGHT_COUNTS.find((n) => n === saved.count) ?? DEFAULTS.count,
    maxSeconds: HIGHLIGHT_LENGTHS.find((n) => n === saved.maxSeconds) ?? DEFAULTS.maxSeconds,
  };
}

export function rememberHighlightOptions(options: HighlightOptions) {
  try {
    localStorage.setItem(`quikclip.1.${KEY}`, JSON.stringify(options));
  } catch {
    // The current search still uses the choices.
  }
}
