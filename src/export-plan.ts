import { FRAME_PRESETS, type Shape } from './studio';

/** Matches `MAX_BATCH_EXPORTS` in src-tauri/src/media.rs. */
export const MAX_EXPORT_FILES = 16;

export type ExportJob = { id: string; shape: Shape };

/** Selected clips in bin order, each in the selected frames, in frame-preset order. */
export function exportJobs(
  cuts: readonly { id: string }[],
  selectedIds: readonly string[],
  shapes: readonly Shape[],
): ExportJob[] {
  const chosen = new Set(selectedIds);
  const frames = (Object.keys(FRAME_PRESETS) as Shape[]).filter((shape) => shapes.includes(shape));
  return cuts
    .filter((cut) => chosen.has(cut.id))
    .flatMap((cut) => frames.map((shape) => ({ id: cut.id, shape })));
}
