import type { Shape } from './studio';

export type SafeInsets = {
  /** Fractions of the output frame, measured inward from each edge. */
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Where this guide comes from. Preview only; exports are not cropped to it. */
  label: string;
};

/**
 * Room left for the destination app's own buttons, adapted from ClipCheap's preview guide.
 * Original frames have no destination chrome.
 * Vertical insets follow a 1080×1920 short (top status, bottom caption, right action column).
 */
const GUIDES: Partial<Record<Shape, SafeInsets>> = {
  vertical: {
    top: 150 / 1920,
    right: 144 / 1080,
    bottom: 420 / 1920,
    left: 48 / 1080,
    label: 'TikTok, Reels, Shorts',
  },
  portrait: {
    top: 80 / 1350,
    right: 48 / 1080,
    bottom: 160 / 1350,
    left: 48 / 1080,
    label: 'Feed portrait',
  },
  square: {
    top: 72 / 1080,
    right: 72 / 1080,
    bottom: 96 / 1080,
    left: 72 / 1080,
    label: 'Feed posts',
  },
  landscape: {
    top: 64 / 1080,
    right: 48 / 1920,
    bottom: 140 / 1080,
    left: 48 / 1920,
    label: 'YouTube',
  },
};

export function safeInsets(shape: Shape): SafeInsets | null {
  return GUIDES[shape] ?? null;
}
