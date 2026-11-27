import { cutBroll } from './broll';
import type { Cut, Video } from './studio';

/** A layer on the selected clip, shown in the timeline's Layers lane: text on the video, or b-roll over it. */
export type LaneLayer = {
  id: string;
  kind: 'text' | 'broll';
  label: string;
  /** Seconds from the clip's in point, on the source clock, and how long it shows. */
  at: number;
  length: number;
};
/** The most rows the lane grows to; layers past them share the last row. */
export const MAX_LANE_ROWS = 3;

/** The clip's text and b-roll, in the order they start. */
export function clipLayers(
  cut: Pick<Cut, 'texts' | 'broll' | 'start' | 'end'>,
  videos: readonly Video[],
): LaneLayer[] {
  const span = cut.end - cut.start;
  const texts: LaneLayer[] = (cut.texts ?? [])
    .filter((text) => Number.isFinite(text.at) && text.at < span)
    .map((text) => ({
      id: text.id,
      kind: 'text',
      label: text.text.trim() || 'Text',
      at: text.at,
      length: Math.min(text.length, span - text.at),
    }));
  const shots: LaneLayer[] = cutBroll(cut, videos).map((shot) => ({
    id: shot.id,
    kind: 'broll',
    label: `${shot.mode === 'pip' ? 'Picture in picture' : 'B-roll'} · ${
      videos.find((video) => video.id === shot.video)?.title ?? 'Video'
    }`,
    at: shot.at,
    length: Math.min(shot.length, span - shot.at),
  }));
  return [...texts, ...shots].sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind));
}

/** Puts each layer on the first row it fits without overlapping another, up to `MAX_LANE_ROWS` rows. */
export function stackLayers<T extends { at: number; length: number }>(layers: readonly T[]) {
  const ends: number[] = [];
  const placed = [...layers]
    .sort((a, b) => a.at - b.at)
    .map((layer) => {
      let row = ends.findIndex((end) => end <= layer.at + 1e-6);
      if (row < 0) row = ends.length < MAX_LANE_ROWS ? ends.length : MAX_LANE_ROWS - 1;
      ends[row] = Math.max(ends[row] ?? 0, layer.at + layer.length);
      return { layer, row };
    });
  return { placed, rows: Math.max(1, ends.length) };
}

/** A layer moved by a drag or a key: kept whole inside the clip, to a twentieth of a second. */
export function moveLayer(at: number, length: number, span: number) {
  return Math.round(Math.min(Math.max(0, at), Math.max(0, span - length)) * 20) / 20;
}
