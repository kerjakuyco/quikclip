import { newId, round, type Cut } from './studio';

/**
 * Text on the video (ClipCheap's text layers): a title, label, quote or call to action placed in the frame for a stretch
 * of the clip, appearing with a fade, a pop, a slide, or typed out. src-tauri texts.rs draws the same for the export.
 */
export type TextPreset = 'title' | 'subtitle' | 'label' | 'quote' | 'cta';
export type TextAnimation = 'none' | 'fade' | 'pop' | 'slide' | 'type';
export type TextLayer = {
  id: string;
  text: string;
  preset: TextPreset;
  /** Seconds from the clip's in point, on the source clock. */
  at: number;
  length: number;
  /** Where its centre sits, as a share of the frame, 0–1. */
  x: number;
  y: number;
  animation: TextAnimation;
  color?: string;
};
/** Size as a share of the frame's short side, bold, italic, and on a box (clip-ai TEXT_PRESETS, texts.rs preset). */
export const TEXT_PRESETS: {
  value: TextPreset;
  label: string;
  size: number;
  bold: boolean;
  italic: boolean;
  box: boolean;
}[] = [
  { value: 'title', label: 'Title', size: 0.085, bold: true, italic: false, box: false },
  { value: 'subtitle', label: 'Subtitle', size: 0.055, bold: true, italic: false, box: false },
  { value: 'label', label: 'Label', size: 0.045, bold: true, italic: false, box: true },
  { value: 'quote', label: 'Quote', size: 0.06, bold: false, italic: true, box: false },
  { value: 'cta', label: 'Call to action', size: 0.058, bold: true, italic: false, box: true },
];
export const TEXT_ANIMATIONS: { value: TextAnimation; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'pop', label: 'Pop' },
  { value: 'slide', label: 'Slide up' },
  { value: 'type', label: 'Type' },
];
/** Nine places in the frame: thirds across and down. */
export const TEXT_PLACES = [0.2, 0.5, 0.8].flatMap((y, row) =>
  [0.2, 0.5, 0.8].map((x, col) => ({
    x,
    y: [0.16, 0.5, 0.8][row],
    label: `${['Top', 'Middle', 'Bottom'][row]} ${['left', 'centre', 'right'][col]}`,
  })),
);
export const MAX_TEXTS = 8;
export const MAX_TEXT_CHARS = 160;
const MIN_LENGTH = 0.2;
/** Seconds a typed-out text takes per letter (texts.rs TYPE_STEP). */
const TYPE_STEP = 0.045;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function textPreset(layer: Pick<TextLayer, 'preset'>) {
  return TEXT_PRESETS.find((item) => item.value === layer.preset) ?? TEXT_PRESETS[0];
}

/** The clip's text layers that still show: with words, inside the clip, and long enough. */
export function cutTexts(cut: Pick<Cut, 'texts' | 'start' | 'end'>): TextLayer[] {
  const span = cut.end - cut.start;
  return (cut.texts ?? [])
    .filter(
      (layer) =>
        layer &&
        typeof layer.id === 'string' &&
        typeof layer.text === 'string' &&
        layer.text.trim().length > 0 &&
        TEXT_PRESETS.some((item) => item.value === layer.preset) &&
        TEXT_ANIMATIONS.some((item) => item.value === layer.animation) &&
        [layer.at, layer.length, layer.x, layer.y].every(finite) &&
        layer.length >= MIN_LENGTH &&
        layer.at >= 0 &&
        layer.at < span,
    )
    .slice(0, MAX_TEXTS);
}

/** A new title at the playhead, near the top, popping in, for three seconds or what's left of the clip. */
export function newText(cut: Pick<Cut, 'start' | 'end'>, playhead: number): TextLayer {
  const span = cut.end - cut.start;
  const at = round(Math.min(Math.max(0, playhead - cut.start), Math.max(0, span - 1)));
  return {
    id: newId(),
    text: 'Your title',
    preset: 'title',
    at,
    length: round(Math.max(MIN_LENGTH, Math.min(3, span - at))),
    x: 0.5,
    y: 0.16,
    animation: 'pop',
  };
}

/** What an export sends for each layer. */
export function textsRequest(layers: readonly TextLayer[]) {
  return layers.map(({ text, preset, at, length, x, y, animation, color }) => ({
    text: text.trim().slice(0, MAX_TEXT_CHARS),
    preset,
    at,
    length,
    x,
    y,
    animation: animation === 'none' ? '' : animation,
    color: color ?? '',
  }));
}

/** The layers showing at a source time, with how far into each it is. */
export function textsAt(layers: readonly TextLayer[], start: number, time: number) {
  const into = time - start;
  return layers
    .filter((layer) => into >= layer.at && into < layer.at + layer.length)
    .map((layer) => ({ layer, offset: into - layer.at }));
}

const ramp = (t: number, from: number, to: number) =>
  to <= from ? 1 : Math.min(1, Math.max(0, (t - from) / (to - from)));

/**
 * How a layer looks `offset` seconds after it appears, as texts.rs draws it: its opacity, scale, how far below its place
 * it still is (a share of the frame's height), and how many letters show.
 */
export function textFrame(layer: Pick<TextLayer, 'animation' | 'length' | 'text'>, offset: number) {
  const left = layer.length - offset;
  const letters = layer.text.trim().length;
  const fade = (fadeIn: number, fadeOut: number) =>
    Math.min(ramp(offset, 0, fadeIn), ramp(left, 0, fadeOut));
  switch (layer.animation) {
    case 'fade':
      return { opacity: fade(0.25, 0.25), scale: 1, lift: 0, letters };
    case 'pop': {
      const scale =
        offset < 0.18 ? 0.6 + 0.48 * ramp(offset, 0, 0.18) : 1.08 - 0.08 * ramp(offset, 0.18, 0.28);
      return { opacity: fade(0.12, 0.2), scale, lift: 0, letters };
    }
    case 'slide':
      return {
        opacity: fade(0.2, 0.2),
        scale: 1,
        lift: 0.05 * (1 - ramp(offset, 0, 0.3)),
        letters,
      };
    case 'type': {
      const step = Math.min(TYPE_STEP, Math.max(0.1, layer.length - 0.3) / Math.max(1, letters));
      return {
        opacity: 1,
        scale: 1,
        lift: 0,
        letters: Math.min(letters, Math.floor(offset / step) + 1),
      };
    }
    default:
      return { opacity: 1, scale: 1, lift: 0, letters };
  }
}
