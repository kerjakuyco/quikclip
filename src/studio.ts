import type { CutCaptions } from './captions';
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
export type Shape = 'source' | 'vertical' | 'square';
/** How a cropped frame is filled. `fill` is a center crop. `blur` keeps the whole picture on a darkened blurred copy, matching clip-ai's `fit == "blur"`. */
export type Fit = 'fill' | 'blur';
export type Cut = {
  id: string;
  title: string;
  start: number;
  end: number;
  shape: Shape;
  fit?: Fit;
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
/** Saved cuts from before Fit existed stay on the center crop. */
export function cutFit(cut: Pick<Cut, 'fit'>): Fit {
  return cut.fit === 'blur' ? 'blur' : 'fill';
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
/** Pixel size of an exported frame. Vertical and square match `frame_size` in media.rs. */
export function outputFrame(shape: Shape, width: number, height: number) {
  if (shape === 'vertical') {
    return {
      width: truncEven(Math.min(width, (height * 9) / 16)),
      height: truncEven(Math.min(height, (width * 16) / 9)),
    };
  }
  if (shape === 'square') {
    const side = truncEven(Math.min(width, height));
    return { width: side, height: side };
  }
  return { width: Math.max(2, width), height: Math.max(2, height) };
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
};
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
