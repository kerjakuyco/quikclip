import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';

export const desktop = isTauri();
export type Shape = 'source' | 'vertical' | 'square';
export type Cut = { id: string; title: string; start: number; end: number; shape: Shape };
export type Project = {
  id: string;
  title: string;
  source: 'Sample' | 'Local video' | 'YouTube';
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
    cuts: [{ id, title: 'First cut', start: 0, end: Math.min(p.duration, 15), shape: 'source' }],
  };
}
export async function nativeImport(url?: string) {
  const media = await invoke<Omit<Project, 'source' | 'cuts' | 'selected'> | null>(
    url ? 'import_youtube' : 'import_local',
    url ? { url } : {},
  );
  return media && withCuts({ ...media, source: url ? 'YouTube' : 'Local video' });
}
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('quikclip-media', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('videos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
    if (!Number.isFinite(duration) || duration < 0.25 || duration > 7200)
      throw Error('Choose a video between 0.25 seconds and two hours long.');
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
