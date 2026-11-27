import { clamp, clock, round } from './studio';

export type TimelineView = { start: number; span: number };
export type TrimSnap = 'off' | 'frames' | 'words';
export type TrimMotion = { step?: -1 | 1; free?: boolean };
export const MIN_CLIP = 0.25;
export const minViewSpan = (duration: number) => Math.min(1, duration);

export function boundView(start: number, span: number, duration: number): TimelineView {
  const width = clamp(span, minViewSpan(duration), duration);
  return { start: clamp(start, 0, duration - width), span: width };
}

export function zoomView(view: TimelineView, duration: number, factor: number, anchor: number) {
  const fraction = clamp((anchor - view.start) / view.span, 0, 1);
  const span = clamp(view.span * factor, minViewSpan(duration), duration);
  return boundView(anchor - fraction * span, span, duration);
}

export function fitClip(start: number, end: number, duration: number) {
  const span = clamp((end - start) * 1.2, minViewSpan(duration), duration);
  return boundView((start + end - span) / 2, span, duration);
}

const TICK_STEPS = [
  0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400,
  21600, 43200,
];
export function rulerTicks(view: TimelineView, width: number) {
  const minStep = (view.span * 82) / Math.max(82, width);
  const step = TICK_STEPS.find((value) => value >= minStep) ?? view.span;
  const first = Math.ceil((view.start - 1e-8) / step);
  const last = Math.floor((view.start + view.span + 1e-8) / step);
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const at = (first + i) * step;
    return { at, label: clock(at, step < 1) };
  });
}

/** Clamp to the legal trim range and, when requested, choose the nearest frame inside it. */
export function trimTime(time: number, min: number, max: number, fps: number) {
  const at = clamp(time, min, max);
  if (fps > 0) {
    const first = Math.ceil(min * fps - 1e-8);
    const last = Math.floor(max * fps + 1e-8);
    if (first <= last) return clamp(clamp(Math.round(at * fps), first, last) / fps, min, max);
  }
  return clamp(round(at), min, max);
}

/** Index a transcript once, so dragging can find nearby edges even in a multi-hour recording. */
export function wordEdges(words: readonly { start: number; end: number }[]) {
  const start: number[] = [];
  const end: number[] = [];
  for (const word of words) {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start)
      continue;
    start.push(word.start);
    end.push(word.end);
  }
  return { start: start.sort((a, b) => a - b), end: end.sort((a, b) => a - b) };
}

function lowerBound(times: readonly number[], at: number) {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (times[mid] < at) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Use the appropriate word edge near the pointer. Keyboard steps seek the next edge in order. */
export function trimToWord(
  times: readonly number[],
  time: number,
  min: number,
  max: number,
  step?: -1 | 1,
) {
  const inside = (at: number | undefined) => at !== undefined && at >= min && at <= max;
  const at = clamp(time, min, max);
  if (step) {
    const index = step < 0 ? lowerBound(times, at - 1e-7) - 1 : lowerBound(times, at + 1e-7);
    const next = times[index];
    return inside(next) ? next : trimTime(at + step * 0.1, min, max, 0);
  }
  const i = lowerBound(times, at);
  const left = times[i - 1];
  const right = times[i];
  const before = inside(left) ? at - left : Infinity;
  const after = inside(right) ? right - at : Infinity;
  return Math.min(before, after) <= 0.5
    ? before <= after
      ? left
      : right
    : trimTime(at, min, max, 0);
}

/** Keep hundredths for simple values, without hiding a millisecond trim. */
export function trimClock(time: number) {
  const ms = Math.round(time * 1000);
  return clock(ms / 1000, true) + (ms % 10 || '');
}
