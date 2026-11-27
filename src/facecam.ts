import { cutFaces, outputFrame, splitBand, type Cut, type Shape } from './studio';

/**
 * The stacked layout for streams (media.rs stack_filter): the facecam, a box of the source picture, fills the top band
 * of a tall frame (as tall as the split layout's face band), and the gameplay, cut from the source in the shape of the
 * rest, fills the part below at the clip's crop position.
 */
export type CamBox = { x: number; y: number; w: number; h: number };
export type CamCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const CAM_CORNERS: { value: CamCorner; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
];
/** A facecam's width, as a share of the source's: the smallest, the largest, and a new one's. */
export const MIN_CAM = 0.12;
export const MAX_CAM = 0.6;
const DEFAULT_CAM = 0.26;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const round = (n: number) => Math.round(n * 1000) / 1000;

/** The top band's shape (width over height) for a frame. */
export function bandAspect(shape: Shape, width: number, height: number) {
  const frame = outputFrame(shape, width, height);
  return frame.width / splitBand(frame.height);
}

/** A box `w` of the source wide, in the top band's shape, in a corner. */
export function camAt(
  corner: CamCorner,
  w: number,
  shape: Shape,
  width: number,
  height: number,
): CamBox {
  const aspect = bandAspect(shape, width, height);
  let share = clamp(w, MIN_CAM, MAX_CAM);
  let h = (share * width) / aspect / height;
  if (h > 1) {
    share = (share * 1) / h;
    h = 1;
  }
  return {
    x: round(corner.endsWith('left') ? 0 : 1 - share),
    y: round(corner.startsWith('top') ? 0 : 1 - h),
    w: round(share),
    h: round(h),
  };
}

/** The clip's facecam: its own when it is usable, else a new one in the top left. */
export function cutCam(cut: Pick<Cut, 'cam' | 'shape'>, width: number, height: number): CamBox {
  const c = cut.cam;
  if (
    c &&
    [c.x, c.y, c.w, c.h].every(finite) &&
    c.w >= 0.02 &&
    c.h >= 0.02 &&
    c.x >= 0 &&
    c.y >= 0 &&
    c.x + c.w <= 1.001 &&
    c.y + c.h <= 1.001
  )
    return c;
  return camAt('top-left', DEFAULT_CAM, cut.shape, width, height);
}

/** Which corner a facecam is nearest. */
export function camCorner(cam: CamBox): CamCorner {
  const left = cam.x + cam.w / 2 < 0.5;
  const top = cam.y + cam.h / 2 < 0.5;
  return `${top ? 'top' : 'bottom'}-${left ? 'left' : 'right'}`;
}

/**
 * A facecam around the face found most often in the clip: head and shoulders, in the band's shape, kept inside the
 * picture. Null when no faces were found.
 */
export function camFromFaces(
  cut: Pick<Cut, 'faces' | 'shape' | 'start' | 'end'>,
  width: number,
  height: number,
): CamBox | null {
  const found = cutFaces(cut);
  const faces =
    found?.samples
      .filter((sample) => sample.time >= cut.start - 0.5 && sample.time <= cut.end + 0.5)
      .flatMap((sample) =>
        sample.faces.length
          ? [sample.faces.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b))]
          : [],
      ) ?? [];
  if (!faces.length) return null;
  const middle = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1];
  const cx = middle(faces.map((face) => face.x + face.w / 2));
  const cy = middle(faces.map((face) => face.y + face.h / 2));
  const fw = middle(faces.map((face) => face.w));
  const aspect = bandAspect(cut.shape, width, height);
  // Head and shoulders: about three faces wide.
  let w = clamp(fw * 3, MIN_CAM, MAX_CAM);
  let h = (w * width) / aspect / height;
  if (h > 1) {
    w /= h;
    h = 1;
  }
  return {
    x: round(clamp(cx - w / 2, 0, 1 - w)),
    // A little above the face's middle, so the shoulders show.
    y: round(clamp(cy - h * 0.42, 0, 1 - h)),
    w: round(w),
    h: round(h),
  };
}
