/**
 * The calm camera (clip-ai `reframe.calm_path`): hold while a face shifts a little, then glide
 * after a real move. The same points drive the preview and the export crop.
 */
/** `motion`: how much the mouth moves, in grey levels (src-tauri faces.rs), when the speaker was asked for. */
export type FaceBox = { x: number; y: number; w: number; h: number; motion?: number };
export type FaceSample = { time: number; faces: FaceBox[] };
/** `t` is seconds from the clip's in point. `x` and `y` are crop travel, 0–100. */
export type CameraPoint = { t: number; x: number; y: number };

const NEIGHBOR_SECONDS = 1.25;
const DEADZONE = 7;
const GLIDE = 0.45;
const GLIDE_STEPS = 4;

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function largest(faces: FaceBox[]): FaceBox | null {
  let best: FaceBox | null = null;
  let area = 0;
  for (const face of faces) {
    if (
      ![face.x, face.y, face.w, face.h].every((n) => Number.isFinite(n)) ||
      face.w <= 0 ||
      face.h <= 0
    )
      continue;
    const size = face.w * face.h;
    if (size > area) {
      area = size;
      best = face;
    }
  }
  return best;
}

/**
 * The largest face in each sample, dropped when it appears in only one sample.
 * A neighbor within 1.25 s is enough; the detector does not report a confidence.
 */
export function keptFaces(samples: FaceSample[]): (FaceBox | null)[] {
  const best = samples.map((sample) => largest(sample.faces));
  return best.map((box, index) => {
    if (!box) return null;
    const seenAgain = [index - 1, index + 1].some((other) => {
      if (other < 0 || other >= best.length || !best[other]) return false;
      return Math.abs(samples[index].time - samples[other].time) <= NEIGHBOR_SECONDS;
    });
    return seenAgain ? box : null;
  });
}

/** A mouth moving this much (grey levels, face movement taken off) is talking. */
const SPEAKING = 2.5;
/** The talker leads when their mouth moves this many times more than anyone else's. */
const LEADS = 1.6;
/** A new talker takes the frame after leading this long; crosstalk and pauses keep the shot. */
const SWITCH_SECONDS = 0.6;
/** Samples the current face may go missing before the largest face takes over. */
const HOLD_SAMPLES = 2;

const centre = (face: FaceBox) => ({ x: face.x + face.w / 2, y: face.y + face.h / 2 });
function near(a: FaceBox, b: FaceBox) {
  const [p, q] = [centre(a), centre(b)];
  return (
    Math.abs(p.x - q.x) < Math.max(0.08, a.w * 0.8) && Math.abs(p.y - q.y) < Math.max(0.1, a.h)
  );
}
const gap = (a: FaceBox, b: FaceBox) =>
  Math.hypot(centre(a).x - centre(b).x, centre(a).y - centre(b).y);
const valid = (face: FaceBox) =>
  [face.x, face.y, face.w, face.h].every((n) => Number.isFinite(n)) && face.w > 0 && face.h > 0;

/**
 * Whoever is talking in each sample (clip-ai reframe.speaker_track): the shot holds on its face, moving with it, until
 * another face has clearly led the talking for SWITCH_SECONDS. Two mouths moving alike is crosstalk, and the shot stays.
 * With no talking yet it starts on the largest face.
 */
export function speakerFaces(samples: FaceSample[]): (FaceBox | null)[] {
  let current: FaceBox | null = null;
  let candidate: FaceBox | null = null;
  let since = 0;
  let missing = 0;
  return samples.map((sample) => {
    const faces = sample.faces.filter(valid);
    const held = current;
    const match = held
      ? faces.filter((face) => near(face, held)).sort((a, b) => gap(a, held) - gap(b, held))[0]
      : undefined;
    if (match) {
      current = match;
      missing = 0;
    } else if (!current || ++missing > HOLD_SAMPLES) {
      current = largest(faces);
      missing = 0;
    }
    const ranked = [...faces].sort((a, b) => (b.motion ?? 0) - (a.motion ?? 0));
    const [top, second] = ranked;
    const leads =
      !!top &&
      (top.motion ?? 0) >= SPEAKING &&
      (!second || (top.motion ?? 0) >= LEADS * (second.motion ?? 0));
    const talker = leads ? top : null;
    if (talker && (!current || !near(talker, current))) {
      if (candidate && near(talker, candidate)) {
        candidate = talker;
        if (sample.time - since >= SWITCH_SECONDS) {
          current = talker;
          candidate = null;
          missing = 0;
        }
      } else {
        candidate = talker;
        since = sample.time;
      }
    } else {
      candidate = null;
    }
    return current;
  });
}

/** Crop percent that puts this face in the middle of the output frame. */
export function aimFace(
  face: FaceBox,
  frame: { cropW: number; cropH: number },
): { x: number; y: number } {
  const cropW = clamp(frame.cropW, 0.01, 1);
  const cropH = clamp(frame.cropH, 0.01, 1);
  const cx = clamp(face.x + face.w / 2, 0, 1);
  const cy = clamp(face.y + face.h / 2, 0, 1);
  const travelX = 1 - cropW;
  const travelY = 1 - cropH;
  const left = clamp(cx - cropW / 2, 0, travelX);
  const top = clamp(cy - cropH / 2, 0, travelY);
  return {
    x: travelX < 0.004 ? 50 : (left / travelX) * 100,
    y: travelY < 0.004 ? 50 : (top / travelY) * 100,
  };
}

function smooth(u: number) {
  return u * u * (3 - 2 * u);
}

/**
 * Points from the clip's in point. Empty when no face lasts more than one sample:
 * the frame then stays centered.
 */
export function calmPath(
  samples: FaceSample[],
  range: { start: number; end: number },
  frame: { cropW: number; cropH: number },
  follow: 'largest' | 'speaker' = 'largest',
): CameraPoint[] {
  const duration = range.end - range.start;
  if (!(duration > 0)) return [];
  const inside = samples
    .filter((sample) => sample.time >= range.start - 0.001 && sample.time <= range.end + 0.001)
    .sort((a, b) => a.time - b.time);
  const faces = follow === 'speaker' ? speakerFaces(inside) : keptFaces(inside);
  if (!faces.some(Boolean)) return [];
  let cam = { x: 50, y: 50 };
  for (let i = 0; i < faces.length; i++) {
    if (faces[i]) {
      cam = aimFace(faces[i]!, frame);
      break;
    }
  }
  const points: CameraPoint[] = [{ t: 0, x: cam.x, y: cam.y }];
  const push = (t: number, x: number, y: number) => {
    const at = clamp(t, 0, duration);
    const last = points[points.length - 1];
    if (Math.abs(last.t - at) < 1e-3) points[points.length - 1] = { t: at, x, y };
    else points.push({ t: at, x, y });
  };
  inside.forEach((sample, index) => {
    const face = faces[index];
    if (!face) return;
    const target = aimFace(face, frame);
    if (Math.abs(target.x - cam.x) <= DEADZONE && Math.abs(target.y - cam.y) <= DEADZONE) return;
    const t0 = clamp(sample.time - range.start, 0, duration);
    const t1 = Math.min(duration, t0 + GLIDE);
    const from = cam;
    push(t0, from.x, from.y);
    for (let step = 1; step <= GLIDE_STEPS; step++) {
      const u = step / GLIDE_STEPS;
      const eased = smooth(u);
      push(
        t0 + (t1 - t0) * u,
        from.x + (target.x - from.x) * eased,
        from.y + (target.y - from.y) * eased,
      );
    }
    cam = target;
  });
  push(duration, cam.x, cam.y);
  return points;
}

export function cameraAt(points: CameraPoint[], t: number): { x: number; y: number } {
  if (!points.length) return { x: 50, y: 50 };
  if (t <= points[0].t) return points[0];
  const last = points[points.length - 1];
  if (t >= last.t) return last;
  for (let i = 1; i < points.length; i++) {
    const next = points[i];
    const prev = points[i - 1];
    if (t <= next.t) {
      const span = next.t - prev.t || 1;
      const u = (t - prev.t) / span;
      return { x: prev.x + (next.x - prev.x) * u, y: prev.y + (next.y - prev.y) * u };
    }
  }
  return last;
}
