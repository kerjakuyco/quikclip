import type { CutCaptions } from './captions';
import type { BRoll } from './broll';
import type { TextLayer } from './texts';
import type { Post } from './post';
import { calmPath, cameraAt, type CameraPoint, type FaceSample } from './camera';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import {
  LOGO_CORNERS,
  MAX_LOGO_BYTES,
  MAX_LOGO_SIDE,
  MIN_LOGO_SIDE,
  pngSize,
  type LogoCorner,
} from './logo';
import {
  audioDuration,
  MAX_MUSIC_BYTES,
  MAX_MUSIC_SECONDS,
  MUSIC_DEFAULTS,
  trackName,
  type MusicSettings,
} from './music';

export const desktop = isTauri();
export const FRAME_PRESETS = {
  source: { label: 'Original', name: 'Original', ratio: null },
  landscape: { label: '16:9', name: 'Landscape', ratio: [16, 9] },
  vertical: { label: '9:16', name: 'Vertical', ratio: [9, 16] },
  square: { label: '1:1', name: 'Square', ratio: [1, 1] },
  portrait: { label: '4:5', name: 'Feed portrait', ratio: [4, 5] },
} as const;
export type Shape = keyof typeof FRAME_PRESETS;
/**
 * `fill` crops to the output frame. `blur` keeps the whole picture on a darkened blurred copy. `split` (vertical frames)
 * puts a crop of the speaker's face on top and the whole picture below (ClipCheap's split layout).
 */
export type Fit = 'fill' | 'blur' | 'split';
/** Percentage of the available crop travel, measured from the left and top edges. */
export type CropPosition = { x: number; y: number };
export const CENTER_CROP: Readonly<CropPosition> = { x: 50, y: 50 };
/** Where a filled frame sits. Absent means by hand, so older clips keep the crop sliders. `speaker` follows whoever is
 *  talking. */
export type Framing = 'center' | 'hand' | 'faces' | 'speaker';
/** Export loudness. Absent leaves the clip's sound as it was. */
export type Loudness = 'standard' | 'loud' | 'louder';
export const LOUDNESS = [
  ['standard', 'Standard', -16],
  ['loud', 'Loud', -14],
  ['louder', 'Louder', -11],
] as const;
export type Cut = {
  id: string;
  title: string;
  start: number;
  end: number;
  shape: Shape;
  fit?: Fit;
  /** Absent in older clips, which keep their centered crop. */
  crop?: CropPosition;
  /** Absent means by hand. `center` ignores the saved crop. `faces` follows the calm camera. */
  framing?: Framing;
  /** Faces found in the clip (src-tauri faces.rs), on the source clock: the calm camera is worked out from them for the
   *  clip's current range, so a trim keeps them. */
  faces?: CutFaces;
  /** Integrated loudness on export, in LUFS. Absent means this clip is not normalized on its own. */
  loudness?: Loudness;
  /** Shown at the top of the frame. Empty means no headline, matching a clip from before this field existed. */
  headline?: string;
  /** 90 Hz high-pass on export (clip-ai `highpass=f=90`). Absent stays off, so older clips keep their sound. */
  voice?: boolean;
  /** A track under the clip. Absent means no music, so older clips keep their sound. */
  music?: CutMusic;
  /** Drop quiet stretches of half a second or more. Absent stays off, so older clips keep every moment. */
  pauses?: boolean;
  /** A PNG in a corner. Absent means no logo, so older clips stay unmarked. */
  logo?: CutLogo;
  /** Playback speed of the export. Absent is 1×, so older clips stay the same length. */
  speed?: number;
  /** Burned-in captions from the clip's speech. Absent means none, so older clips stay as they were. */
  captions?: CutCaptions;
  /** Editorial notes from the AI's suggested range, not a forecast of performance. */
  highlight?: { score?: number; reason?: string };
  /** Cut its ums and uhs (polish.ts), from the transcript. Absent keeps every word. */
  fillers?: boolean;
  /** Zoom in on every other sentence (polish.ts), from the transcript. Absent keeps one framing. */
  punch?: boolean;
  /** The project video this clip cuts from (Video.id). Absent is the project's first video. */
  video?: string;
  /** Other footage over parts of the clip (broll.ts). Absent shows the clip alone. */
  broll?: BRoll[];
  /** Text on the video (texts.ts). Absent shows none. */
  texts?: TextLayer[];
  /** Post copy written for it (post.ts). */
  posts?: Post[];
};
export type CutLogo = {
  /** Desktop file path, or the browser blob id. */
  source: string;
  name: string;
  width: number;
  height: number;
  corner: LogoCorner;
};
export type CutMusic = MusicSettings & {
  /** Desktop file path, or the browser blob id. */
  source: string;
  name: string;
  duration: number;
};
/** Saved cuts from before Fit existed stay on Fill, and a split on a frame that isn't tall becomes Fill. */
export function cutFit(cut: Pick<Cut, 'fit'> & { shape?: Shape }): Fit {
  if (cut.fit === 'split') return !cut.shape || splitShape(cut.shape) ? 'split' : 'fill';
  return cut.fit === 'blur' ? 'blur' : 'fill';
}
/** The split layout is for frames taller than wide. */
export function splitShape(shape: Shape) {
  return shape === 'vertical' || shape === 'portrait';
}
/** The split layout's face band: the top 42% of the frame, even (media.rs SPLIT_TOP and split_band). */
export const SPLIT_TOP = 0.42;
export function splitBand(frameHeight: number) {
  return Math.max(1, Math.round((frameHeight * SPLIT_TOP) / 2)) * 2;
}
/** What the crop moves over the source: the output frame, or for the split layout its face band. */
export function cropBox(cut: Pick<Cut, 'shape' | 'fit'>, width: number, height: number) {
  const frame = outputFrame(cut.shape, width, height);
  return cut.shape !== 'source' && cutFit(cut) === 'split'
    ? { width: frame.width, height: splitBand(frame.height) }
    : frame;
}
/** A box placed on the source at a crop position, on even offsets like FFmpeg's 4:2:0 crop. */
export function cropRect(
  box: { width: number; height: number },
  crop: CropPosition,
  width: number,
  height: number,
) {
  const { x, y } = cutCrop({ crop });
  const offset = (travel: number, position: number) =>
    2 * Math.floor((Math.max(0, travel) * position) / 200);
  return { ...box, left: offset(width - box.width, x), top: offset(height - box.height, y) };
}
export function cutCrop(cut: Pick<Cut, 'crop'>): CropPosition {
  const axis = (n: number | undefined) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.round(clamp(n, 0, 100)) : 50;
  return { x: axis(cut.crop?.x), y: axis(cut.crop?.y) };
}
/** Face samples over [start, end] of the source, as `find_faces` returns them. `speaker`: each face's mouth movement
 *  was measured too, which following the speaker needs. */
export type CutFaces = { start: number; end: number; samples: FaceSample[]; speaker?: boolean };
export function cutFaces(cut: Pick<Cut, 'faces'>): CutFaces | null {
  const f = cut.faces;
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (!f || !finite(f.start) || !finite(f.end) || f.end <= f.start || !Array.isArray(f.samples))
    return null;
  return {
    start: f.start,
    end: f.end,
    speaker: f.speaker === true,
    samples: f.samples
      .filter((s) => finite(s?.time) && Array.isArray(s.faces))
      .map((s) => ({
        time: s.time,
        faces: s.faces.filter((b) => [b?.x, b?.y, b?.w, b?.h].every(finite)),
      })),
  };
}
/**
 * The calm camera for a clip following faces (camera.ts calmPath): points from its in point, as crop travel 0–100. Empty
 * when it isn't following faces, has none found yet, or no face lasts: the frame then holds its centre.
 */
export function cutCamera(
  cut: Pick<Cut, 'shape' | 'fit' | 'framing' | 'faces' | 'start' | 'end'>,
  width: number,
  height: number,
): CameraPoint[] {
  const faces = cutFaces(cut);
  const framing = cutFraming(cut);
  if (!following(framing) || cut.shape === 'source' || cutFit(cut) === 'blur' || !faces) return [];
  const frame = cropBox(cut, width, height);
  return calmPath(
    faces.samples,
    { start: cut.start, end: cut.end },
    { cropW: frame.width / width, cropH: frame.height / height },
    framing === 'speaker' && faces.speaker ? 'speaker' : 'largest',
  );
}
/** Where the crop sits `at` seconds into the clip: centred, following faces, or by hand. */
export function framedCrop(
  cut: Pick<Cut, 'shape' | 'fit' | 'framing' | 'faces' | 'crop' | 'start' | 'end'>,
  width: number,
  height: number,
  at = 0,
): CropPosition {
  const framing = cutFraming(cut);
  if (framing === 'center') return { ...CENTER_CROP };
  if (following(framing)) {
    const path = cutCamera(cut, width, height);
    if (!path.length) return { ...CENTER_CROP };
    const { x, y } = cameraAt(path, at);
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  }
  return cutCrop(cut);
}
/** The crop sent with an export: the calm camera's points when it moves, else one position. */
export function exportFraming(
  cut: Pick<Cut, 'shape' | 'fit' | 'framing' | 'faces' | 'crop' | 'start' | 'end'>,
  width: number,
  height: number,
) {
  const camera = cutCamera(cut, width, height);
  return {
    crop: cutCrop({ crop: framedCrop(cut, width, height) }),
    camera: camera.length >= 2 ? camera : [],
  };
}
export function cutFraming(cut: Pick<Cut, 'framing'>): Framing {
  return cut.framing === 'center' ||
    cut.framing === 'faces' ||
    cut.framing === 'speaker' ||
    cut.framing === 'hand'
    ? cut.framing
    : 'hand';
}
/** Framings that move with the faces found in the clip. */
export function following(framing: Framing) {
  return framing === 'faces' || framing === 'speaker';
}
export function cutLoudness(cut: Pick<Cut, 'loudness'>): Loudness | null {
  return cut.loudness === 'standard' || cut.loudness === 'loud' || cut.loudness === 'louder'
    ? cut.loudness
    : null;
}
/** The LUFS target sent to ffmpeg, or null when this clip stays as it was recorded. */
export function loudnessLufs(cut: Pick<Cut, 'loudness'>): number | null {
  const level = cutLoudness(cut);
  if (level === 'loud') return -14;
  if (level === 'louder') return -11;
  if (level === 'standard') return -16;
  return null;
}
export function cutVoice(cut: Pick<Cut, 'voice'>) {
  return cut.voice === true;
}
export function cutPauses(cut: Pick<Cut, 'pauses'>) {
  return cut.pauses === true;
}
export function cutLogo(cut: { logo?: CutLogo | null }): CutLogo | null {
  const logo = cut.logo;
  const corner = LOGO_CORNERS.some((item) => item.value === logo?.corner);
  if (
    !logo ||
    typeof logo.source !== 'string' ||
    !logo.source ||
    !corner ||
    !Number.isFinite(logo.width) ||
    !Number.isFinite(logo.height) ||
    logo.width < MIN_LOGO_SIDE ||
    logo.height < MIN_LOGO_SIDE ||
    logo.width > MAX_LOGO_SIDE ||
    logo.height > MAX_LOGO_SIDE
  )
    return null;
  return logo;
}
export function cutMusic(cut: { music?: CutMusic | null }): CutMusic | null {
  const music = cut.music;
  if (
    !music ||
    typeof music.source !== 'string' ||
    !music.source ||
    !Number.isFinite(music.duration) ||
    music.duration <= 0
  )
    return null;
  return music;
}
export const fileSrc = (path: string) => convertFileSrc(path);
function truncEven(value: number) {
  return Math.max(2, Math.trunc(value / 2) * 2);
}
/** Pixel size before any browser downscaling. Match `frame_size` in media.rs. */
export function outputFrame(shape: Shape, width: number, height: number) {
  const ratio = FRAME_PRESETS[shape]?.ratio;
  if (!ratio) return { width: Math.max(2, width), height: Math.max(2, height) };
  const [w, h] = ratio;
  return {
    width: truncEven(Math.min(width, (height * w) / h)),
    height: truncEven(Math.min(height, (width * h) / w)),
  };
}
/** FFmpeg's 4:2:0 crop uses even offsets. Use the same rectangle in the monitor and WebM. */
export function cropFrame(cut: Pick<Cut, 'shape' | 'crop'>, width: number, height: number) {
  const frame = outputFrame(cut.shape, width, height);
  const { x, y } = cutCrop(cut);
  const offset = (travel: number, position: number) =>
    2 * Math.floor((Math.max(0, travel) * position) / 200);
  return {
    ...frame,
    left: offset(width - frame.width, x),
    top: offset(height - frame.height, y),
  };
}
export function browserFrame(frame: { width: number; height: number }) {
  const scale = Math.min(1, 1080 / frame.height);
  return { width: truncEven(frame.width * scale), height: truncEven(frame.height * scale) };
}
export type Project = {
  id: string;
  title: string;
  source: 'Sample' | 'Local video' | 'YouTube' | 'Twitch' | 'Kick';
  path: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  frames: string[];
  wave?: string | null;
  poster?: string;
  cuts: Cut[];
  selected: string;
  /** Words corrected in the transcript, by index (captions.ts TranscriptFixes). */
  fixes?: Record<number, string>;
  /** More videos in the project (ClipCheap's media), after the first, which is the project's own fields. */
  videos?: Video[];
  /** A video played before (`intro`) and after (`outro`) the project's joined exports. */
  bookends?: { intro?: Bookend; outro?: Bookend };
};
/** An opening shot or end card: a short video copied into the library (src-tauri join.rs). */
export type Bookend = { path: string; name: string; duration: number };
/** How joined clips meet (src-tauri join.rs xfade_name). */
export const TRANSITIONS = [
  ['cut', 'Cut'],
  ['fade', 'Fade'],
  ['dissolve', 'Dissolve'],
  ['slide', 'Slide'],
  ['wipe', 'Wipe'],
  ['zoom', 'Zoom'],
] as const;
export type Transition = (typeof TRANSITIONS)[number][0];
/**
 * A video added to a project: its own editing copy, frames, waveform and transcript, all under its own id, as a
 * project's first video has them under the project's id.
 */
export type Video = Pick<
  Project,
  | 'title'
  | 'source'
  | 'path'
  | 'duration'
  | 'width'
  | 'height'
  | 'fps'
  | 'frames'
  | 'wave'
  | 'poster'
  | 'fixes'
> & { id: string };
/** The most videos one project holds (ClipCheap's 24 sources). */
export const MAX_VIDEOS = 24;
/** Every video in a project, the first one first. */
export function projectVideos(p: Project): Video[] {
  const { id, title, source, path, duration, width, height, fps, frames, wave, poster, fixes } = p;
  return [
    { id, title, source, path, duration, width, height, fps, frames, wave, poster, fixes },
    ...(p.videos ?? []),
  ];
}
/**
 * The video a clip cuts from, as a project: the project with its media swapped for that video's, so everything that
 * plays, reads, or exports a source works on either. A clip of a video since removed falls back to the first.
 */
export function mediaOf(p: Project, cut?: Pick<Cut, 'video'> | null): Project {
  const v = cut?.video ? p.videos?.find((item) => item.id === cut.video) : undefined;
  if (!v) return p;
  return {
    ...p,
    id: v.id,
    title: v.title,
    source: v.source,
    path: v.path,
    duration: v.duration,
    width: v.width,
    height: v.height,
    fps: v.fps,
    frames: v.frames,
    wave: v.wave,
    poster: v.poster,
    fixes: v.fixes,
  };
}
/** The project with one of its videos changed: the first (the project's own fields) or an added one. */
export function withMedia(p: Project, id: string, patch: Partial<Video>): Project {
  if (p.id === id) return { ...p, ...patch, id: p.id };
  if (!p.videos?.some((item) => item.id === id)) return p;
  return {
    ...p,
    videos: p.videos.map((item) => (item.id === id ? { ...item, ...patch, id } : item)),
  };
}
/** Whether a clip cuts from this video of the project. */
export function onVideo(p: Project, cut: Pick<Cut, 'video'>, id: string) {
  return mediaOf(p, cut).id === id;
}
export type ExportEntry = {
  id: string;
  title: string;
  path: string;
  duration: number;
  date: string;
  project: string;
};
export const newId = () => crypto.randomUUID();
export const round = (n: number) => Math.round(n * 1000) / 1000;
export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export function clock(n: number, precise = false) {
  const t = Math.max(0, Math.floor(n * 100 + 0.00001));
  return `${String(Math.floor(t / 6000)).padStart(2, '0')}:${String(Math.floor(t / 100) % 60).padStart(2, '0')}${precise ? '.' + String(t % 100).padStart(2, '0') : ''}`;
}
export function parseTime(value: string) {
  if (!/^(?:\d+:)?\d+(?:\.\d{1,3})?$/.test(value.trim())) return NaN;
  return value
    .trim()
    .split(':')
    .reduce((n, s) => 60 * n + Number(s), 0);
}
export const sample: Project = {
  id: 'sample',
  title: 'Alpine field notes',
  source: 'Sample',
  path: '/sample/alpine.mp4',
  duration: 36,
  width: 1280,
  height: 640,
  fps: 24,
  poster: '/sample/poster.jpg',
  wave: '/sample/wave.png',
  frames: ['ridge', 'summit', 'lake'].map((x) => `/sample/${x}.jpg`),
  cuts: ['Above the clouds', 'Into the valley', 'Still waters'].map((title, i) => ({
    id: `sample-${i}`,
    title,
    start: i * 12,
    end: i * 12 + 12,
    shape: 'source',
    fit: 'fill',
  })),
  selected: 'sample-0',
};
export function asset(p: Project, path?: string | null) {
  if (!path) return undefined;
  return desktop && p.id !== 'sample' ? convertFileSrc(path) : path;
}
export function frame(p: Project, t: number) {
  return asset(
    p,
    p.frames[clamp(Math.floor((t / p.duration) * p.frames.length), 0, p.frames.length - 1)],
  );
}
export function readSaved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(`quikclip.1.${key}`) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
export function withCuts(p: Omit<Project, 'cuts' | 'selected'>): Project {
  const id = newId();
  return {
    ...p,
    selected: id,
    cuts: [
      {
        id,
        title: 'First cut',
        start: 0,
        end: Math.min(p.duration, 15),
        shape: 'source',
        fit: 'fill',
        voice: true,
      },
    ],
  };
}
/** Codecs this app's player can play straight from an MP4. An import keeps a source in one of
 *  these as it is instead of re-encoding it, which is what makes multi-hour recordings quick. */
export function playableCodecs() {
  const probe = document.createElement('video');
  const plays = (type: string) => probe.canPlayType(type) === 'probably';
  return {
    hevc: plays('video/mp4; codecs="hvc1.1.6.L123.B0"'),
    av1: plays('video/mp4; codecs="av01.0.09M.08"'),
    vp9: plays('video/mp4; codecs="vp09.00.40.08"'),
    opus: plays('audio/mp4; codecs="opus"'),
  };
}
const drawing = new Set<string>();
/** Draws a desktop project's waveform once it is open, so a long import is not held up by it.
 *  Resolves to the image path, `null` when the source has no audio, or `undefined` when nothing
 *  was drawn (already drawing, stopped by a delete, or failed); opening the project tries again. */
export async function drawWave(id: string): Promise<string | null | undefined> {
  if (!desktop || id === 'sample' || drawing.has(id)) return undefined;
  drawing.add(id);
  try {
    return await invoke<string | null>('draw_wave', { id });
  } catch {
    return undefined;
  } finally {
    drawing.delete(id);
  }
}
export async function nativeImport(url?: string) {
  const playable = playableCodecs();
  const media = await invoke<
    (Omit<Project, 'source' | 'cuts' | 'selected'> & { source?: string }) | null
  >(url ? 'import_youtube' : 'import_local', url ? { url, playable } : { playable });
  if (!media) return null;
  const { source: reported, ...rest } = media;
  const source = !url
    ? 'Local video'
    : reported === 'Twitch' || reported === 'Kick' || reported === 'YouTube'
      ? reported
      : 'YouTube';
  return withCuts({ ...rest, source });
}
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('quikclip-media', 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos');
      if (!db.objectStoreNames.contains('music')) db.createObjectStore('music');
      if (!db.objectStoreNames.contains('logos')) db.createObjectStore('logos');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function saveMusic(id: string, blob: Blob) {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('music', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(Error('Not enough browser storage for this track.'));
      tx.objectStore('music').put(blob, id);
    });
  } finally {
    db.close();
  }
}
export async function musicBlob(id: string): Promise<Blob> {
  const db = await openDB();
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const req = db.transaction('music').objectStore('music').get(id);
      req.onsuccess = () =>
        req.result
          ? resolve(req.result)
          : reject(Error('The music file is missing. Add it again.'));
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
export async function deleteMusic(id: string) {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('music', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
      tx.objectStore('music').delete(id);
    });
  } finally {
    db.close();
  }
}
export async function saveLogo(id: string, blob: Blob) {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('logos', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(Error('Not enough browser storage for this logo.'));
      tx.objectStore('logos').put(blob, id);
    });
  } finally {
    db.close();
  }
}
export async function logoBlob(id: string): Promise<Blob> {
  const db = await openDB();
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const req = db.transaction('logos').objectStore('logos').get(id);
      req.onsuccess = () =>
        req.result ? resolve(req.result) : reject(Error('The logo file is missing. Add it again.'));
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
async function deleteVideo(id: string) {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('videos', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
      tx.objectStore('videos').delete(id);
    });
  } finally {
    db.close();
  }
}
/** Deletes the copy Quikclip made of a project's video: the desktop editing copy, thumbnails, and
 *  waveform, or the video stored in this browser. The sample ships with the app and has none. */
export async function deleteProjectMedia(id: string) {
  if (id === 'sample') return;
  if (desktop) await invoke('delete_media', { id });
  else await deleteVideo(id);
}
export async function deleteLogo(id: string) {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('logos', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
      tx.objectStore('logos').delete(id);
    });
  } finally {
    db.close();
  }
}
export function releaseLogo(source: string) {
  if (!source) return;
  if (desktop) {
    void invoke('forget_logo', { path: source }).catch(() => {});
    return;
  }
  void deleteLogo(source).catch(() => {});
}
const logoName = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, 120) || 'Untitled logo';
export async function keepLogoFile(file: File, corner: LogoCorner): Promise<CutLogo> {
  if (file.size <= 0) throw Error('Choose a PNG logo to upload.');
  if (file.size > MAX_LOGO_BYTES) throw Error('Logos can be up to 2 MB.');
  const size = pngSize(new Uint8Array(await file.arrayBuffer()));
  const id = newId();
  await saveLogo(id, file);
  return { source: id, name: logoName(file.name), width: size.width, height: size.height, corner };
}
export async function pickLogoFile(corner: LogoCorner): Promise<CutLogo | null> {
  const picked = await invoke<{ path: string; name: string; width: number; height: number } | null>(
    'pick_logo',
  );
  if (!picked) return null;
  return {
    source: picked.path,
    name: picked.name,
    width: picked.width,
    height: picked.height,
    corner,
  };
}
export function releaseMusic(source: string) {
  if (!source) return;
  if (desktop) {
    void invoke('forget_music', { path: source }).catch(() => {});
    return;
  }
  void deleteMusic(source).catch(() => {});
}
/** Releases attachments only after the saved workspace stops referring to them. */
export function releaseUnusedCutMedia(before: Project[], after: Project[]) {
  for (const [key, release] of [
    ['music', releaseMusic],
    ['logo', releaseLogo],
  ] as const) {
    const stale = new Set<string>();
    for (const project of before)
      for (const cut of project.cuts) if (cut[key]?.source) stale.add(cut[key].source);
    for (const project of after)
      for (const cut of project.cuts) if (cut[key]?.source) stale.delete(cut[key].source);
    for (const source of stale) release(source);
  }
}
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'];
export async function keepMusicFile(file: File): Promise<CutMusic> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!AUDIO_EXT.includes(ext)) throw Error('Use an MP3, WAV, M4A, OGG, FLAC, or AAC file.');
  if (file.size <= 0) throw Error('That file has no sound we can read.');
  if (file.size > MAX_MUSIC_BYTES) throw Error('Music files can be up to 20 MB.');
  const duration = await audioDuration(file);
  if (duration > MAX_MUSIC_SECONDS) throw Error('Tracks can be up to 20 minutes long.');
  const id = newId();
  await saveMusic(id, file);
  return { source: id, name: trackName(file.name), duration, volume: MUSIC_DEFAULTS.volume };
}
export async function pickMusicFile(): Promise<CutMusic | null> {
  const picked = await invoke<{ path: string; name: string; duration: number } | null>(
    'pick_music',
  );
  if (!picked) return null;
  return {
    source: picked.path,
    name: picked.name,
    duration: picked.duration,
    volume: MUSIC_DEFAULTS.volume,
  };
}
export async function browserBlob(id: string): Promise<Blob> {
  const db = await openDB();
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const req = db.transaction('videos').objectStore('videos').get(id);
      req.onsuccess = () =>
        req.result ? resolve(req.result) : reject(Error('Source missing. Import the video again.'));
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
function mediaEvent(el: HTMLVideoElement, type: string) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(Error('This browser cannot decode the video. Try the desktop app or an H.264 MP4.'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(type, done);
      el.removeEventListener('error', fail);
    };
    const timer = setTimeout(fail, 15000);
    el.addEventListener(type, done);
    el.addEventListener('error', fail);
  });
}
export async function browserImport(file: File) {
  const el = document.createElement('video');
  const url = URL.createObjectURL(file);
  try {
    const ready = mediaEvent(el, 'loadeddata');
    el.preload = 'auto';
    el.muted = true;
    el.src = url;
    await ready;
    const { duration, videoWidth: width, videoHeight: height } = el;
    if (!Number.isFinite(duration) || duration < 0.25 || duration > 12 * 3600)
      throw Error('Choose a video between 0.25 seconds and 12 hours long.');
    const canvas = document.createElement('canvas');
    canvas.width = 216;
    canvas.height = Math.min(384, Math.max(2, Math.round((216 * height) / width)));
    const frames: string[] = [];
    for (let i = 0; i < 6; i++) {
      if (i) {
        const seeked = mediaEvent(el, 'seeked');
        el.currentTime = (duration * i) / 6;
        await seeked;
      }
      canvas.getContext('2d')!.drawImage(el, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', 0.65));
    }
    const id = newId(),
      db = await openDB();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('videos', 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () =>
          reject(Error('Not enough browser storage. Use the desktop app to import this file.'));
        tx.objectStore('videos').put(file, id);
      });
    } finally {
      db.close();
    }
    return withCuts({
      id,
      title: file.name.replace(/\.[^.]+$/, ''),
      duration,
      width,
      height,
      fps: 0,
      source: 'Local video',
      path: '',
      frames,
    });
  } finally {
    el.removeAttribute('src');
    el.load();
    URL.revokeObjectURL(url);
  }
}
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
