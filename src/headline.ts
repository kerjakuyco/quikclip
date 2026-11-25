import type { Shape } from './studio';

/** ClipCheap's headline box (clip-ai `HEADLINE_*`): bold white lines on a dark box at the top of the frame. */
export const HEADLINE_MAX = 80;
const SPEC = {
  vertical: { top: 0.14, size: 56, columns: 30 },
  square: { top: 0.06, size: 50, columns: 34 },
  wide: { top: 0.06, size: 46, columns: 48 },
} as const;

export type HeadlineSpec = { top: number; size: number; columns: number; fontSize: number };

export function headlineText(value: string | undefined) {
  return (value ?? '').trim().slice(0, HEADLINE_MAX);
}

function aspect(shape: Shape, width: number, height: number) {
  if (shape === 'vertical' || (shape === 'source' && height > width)) return 'vertical' as const;
  if (shape === 'square' || (shape === 'source' && width === height)) return 'square' as const;
  return 'wide' as const;
}

/** Placement for an output frame. `fontSize` is in pixels at `outShort`, the frame's short side. */
export function headlineSpec(
  shape: Shape,
  width: number,
  height: number,
  outShort: number,
): HeadlineSpec {
  const spec = SPEC[aspect(shape, width, height)];
  return { ...spec, fontSize: Math.max(12, Math.round((spec.size * outShort) / 1080)) };
}

/** Greedy wrap at the column count clip-ai uses for this frame. */
export function headlineLines(text: string, columns: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > columns) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The headline box's bottom edge in pixels of the frame (paintHeadline's geometry), or null without a headline. */
export function headlineBottom(
  shape: Shape,
  width: number,
  height: number,
  text: string | undefined,
) {
  const clean = headlineText(text);
  if (!clean) return null;
  const spec = headlineSpec(shape, width, height, Math.min(width, height));
  const lines = headlineLines(clean, spec.columns);
  const pad = Math.max(1, Math.round(spec.fontSize * 0.3));
  return Math.round(height * spec.top) + lines.length * spec.fontSize * 1.36 + pad * 2;
}

type DrawCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Draws the headline in Manrope, the face the studio already loads. Returns nothing when the text is empty. */
export function paintHeadline(
  ctx: DrawCtx,
  shape: Shape,
  width: number,
  height: number,
  text: string,
) {
  const clean = headlineText(text);
  if (!clean) return;
  const spec = headlineSpec(shape, width, height, Math.min(width, height));
  const lines = headlineLines(clean, spec.columns);
  const font = `800 ${spec.fontSize}px "Manrope Variable", sans-serif`;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineHeight = spec.fontSize * 1.36;
  const pad = Math.max(1, Math.round(spec.fontSize * 0.3));
  const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const boxW = Math.min(width * 0.88, widest + pad * 2);
  const boxH = lines.length * lineHeight + pad * 2;
  const x = (width - boxW) / 2;
  const y = Math.round(height * spec.top);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, Math.max(2, spec.fontSize * 0.15));
  ctx.fill();
  ctx.fillStyle = '#fff';
  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, y + pad + lineHeight * i + lineHeight / 2, boxW - pad * 2);
  });
}

/** A transparent PNG of the headline, or null. The desktop export overlays this on the frame. */
export async function headlinePng(shape: Shape, width: number, height: number, text: string) {
  if (!headlineText(text)) return null;
  const spec = headlineSpec(shape, width, height, Math.min(width, height));
  await document.fonts.load(`800 ${spec.fontSize}px "Manrope Variable"`);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('This browser cannot draw the headline.');
  paintHeadline(ctx, shape, width, height, text);
  const url = canvas.toDataURL('image/png');
  return url.slice(url.indexOf(',') + 1);
}
