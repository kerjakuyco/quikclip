/** Background music as clip-ai mixes it (`music_graph`) and the studio preview plays it (`musicAt`). */
export const MUSIC_DEFAULTS = {
  volume: 0.2,
  source_volume: 1,
  fade_in: 0.5,
  fade_out: 1,
  loop: true,
  start: 0,
};
export const MUSIC_TYPES =
  '.mp3,.wav,.m4a,.ogg,.flac,.aac,audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/flac,audio/aac';
export const MAX_MUSIC_BYTES = 20 * 1024 * 1024;
export const MAX_MUSIC_SECONDS = 20 * 60;
const RIGHTS_KEY = 'quikclip.1.musicRights';

export type MusicSettings = {
  volume?: number;
  source_volume?: number;
  fade_in?: number;
  fade_out?: number;
  loop?: boolean;
  start?: number;
};

const share = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
const seconds = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(5, Math.max(0, value)) : fallback;

function settingsOf(music: MusicSettings) {
  return {
    volume: share(music.volume, MUSIC_DEFAULTS.volume),
    source_volume: share(music.source_volume, MUSIC_DEFAULTS.source_volume),
    fade_in: seconds(music.fade_in, MUSIC_DEFAULTS.fade_in),
    fade_out: seconds(music.fade_out, MUSIC_DEFAULTS.fade_out),
    loop: music.loop ?? MUSIC_DEFAULTS.loop,
    start: Math.max(
      0,
      typeof music.start === 'number' && Number.isFinite(music.start) ? music.start : 0,
    ),
  };
}

export function musicVolume(music: MusicSettings) {
  return share(music.volume, MUSIC_DEFAULTS.volume);
}

/**
 * Where the track is and how loud, `time` seconds into the clip. Fades are linear, like ffmpeg `afade`, and never longer
 * than half the clip. `position` null: the music is silent there.
 */
export function musicBed(
  time: number,
  music: MusicSettings,
  trackDuration: number,
  length: number,
): { position: number | null; volume: number } {
  const settings = settingsOf(music);
  if (time < 0 || time > length || trackDuration <= 0) return { position: null, volume: 0 };
  let position = settings.start + time;
  if (position >= trackDuration) {
    if (!settings.loop) return { position: null, volume: 0 };
    position %= trackDuration;
  }
  const fadeIn = Math.min(settings.fade_in, length / 2);
  const fadeOut = Math.min(settings.fade_out, length / 2);
  let gain = 1;
  if (fadeIn > 0 && time < fadeIn) gain = time / fadeIn;
  if (fadeOut > 0 && time > length - fadeOut) gain = Math.min(gain, (length - time) / fadeOut);
  return { position, volume: Math.min(1, Math.max(0, settings.volume * gain)) };
}

/** Preview position, rounded to a millisecond the way the ClipCheap studio seeks the track. */
export function musicAt(time: number, music: MusicSettings, trackDuration: number, length: number) {
  const state = musicBed(time, music, trackDuration, length);
  if (state.position === null) return state;
  return { position: Math.round(state.position * 1000) / 1000, volume: state.volume };
}

export function audioDuration(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = () => {
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      audio.load();
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const seconds = audio.duration;
      done();
      if (Number.isFinite(seconds) && seconds > 0) resolve(seconds);
      else reject(Error('That file has no sound we can read.'));
    };
    audio.onerror = () => {
      done();
      reject(Error('That file has no sound we can read.'));
    };
    audio.src = url;
  });
}

export const trackName = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, 120) || 'Untitled track';

export function musicRights() {
  try {
    return localStorage.getItem(RIGHTS_KEY) === 'yes';
  } catch {
    return false;
  }
}

export function saveMusicRights(confirmed: boolean) {
  try {
    if (confirmed) localStorage.setItem(RIGHTS_KEY, 'yes');
    else localStorage.removeItem(RIGHTS_KEY);
  } catch {
    /* The current session can still use the checkbox. */
  }
}
