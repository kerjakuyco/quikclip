import { invoke } from '@tauri-apps/api/core';
import { browserBlob, desktop, type Cut, type Project } from './studio';

/** clip-ai `PAUSE_MIN`, `PAUSE_NOISE`, and `PAUSE_PAD` (service/core.py). Quiet shorter than this stays. */
export const PAUSE_MIN = 0.5;
export const PAUSE_PAD = 0.12;
const PAUSE_NOISE = 10 ** (-35 / 20);
const WORTH = 0.3;

export type PauseSpan = { start: number; end: number };
/** What a cut loses when pauses are taken out. `kept` is on the clip clock and is set only when the cut is actually shorter. */
export type PausePlan = {
  cuts: PauseSpan[];
  kept: [number, number][] | null;
  count: number;
  seconds: number;
  spoken: number;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function emptyPlan(duration: number): PausePlan {
  return { cuts: [], kept: null, count: 0, seconds: 0, spoken: Math.max(0, duration) };
}

/** silencedetect lines. An open silence runs to the end of the clip. Times are clip-relative. */
export function parseSilences(log: string, duration: number): [number, number][] {
  const spans: [number, number][] = [];
  let start: number | null = null;
  for (const line of log.split('\n')) {
    const opened = line.split('silence_start:')[1];
    if (line.includes('silence_start:') && opened) {
      const value = Number(opened.trim().split(/\s+/)[0]);
      if (Number.isFinite(value)) start = Math.max(0, value);
      continue;
    }
    const closed = line.split('silence_end:')[1];
    if (line.includes('silence_end:') && closed && start !== null) {
      const value = Number(closed.trim().split(/\s+/)[0]);
      if (Number.isFinite(value)) spans.push([start, Math.min(duration, value)]);
      start = null;
    }
  }
  if (start !== null && start < duration) spans.push([start, duration]);
  return spans;
}

/**
 * What stays after each silence loses its padding (clip-ai `kept_ranges`).
 * A silence on the first or last frame is cut all the way to that edge.
 * The whole clip comes back when nothing worth keeping would remain.
 */
export function keptRanges(silences: [number, number][], duration: number): [number, number][] {
  const ordered = silences
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);
  const kept: [number, number][] = [];
  let at = 0;
  for (const [start, end] of ordered) {
    const cutStart = start <= 0.01 ? 0 : start + PAUSE_PAD;
    const cutEnd = end >= duration - 0.01 ? duration : end - PAUSE_PAD;
    if (cutEnd - cutStart < 0.2 || (cutStart <= at && at > 0)) continue;
    kept.push([round3(at), round3(cutStart)]);
    at = cutEnd;
  }
  if (duration - at > 0.05) kept.push([round3(at), round3(duration)]);
  const spans = kept.filter(([start, end]) => end - start > 0.01);
  return spans.length ? spans : [[0, round3(duration)]];
}

/** The cut is applied only when the spoken part is at least 0.3s shorter (clip-ai pipeline). */
export function planFromSilences(
  silences: [number, number][],
  duration: number,
  origin: number,
): PausePlan {
  if (!(duration > 0)) return emptyPlan(0);
  const kept = keptRanges(silences, duration);
  const spoken = kept.reduce((sum, [start, end]) => sum + (end - start), 0);
  if (!(spoken < duration - WORTH)) return emptyPlan(duration);
  const cuts: PauseSpan[] = [];
  let cursor = 0;
  for (const [start, end] of kept) {
    if (start - cursor > 0.01) {
      cuts.push({ start: round3(origin + cursor), end: round3(origin + start) });
    }
    cursor = end;
  }
  if (duration - cursor > 0.01) {
    cuts.push({ start: round3(origin + cursor), end: round3(origin + duration) });
  }
  return {
    cuts,
    kept,
    count: cuts.length,
    seconds: round3(duration - spoken),
    spoken: round3(spoken),
  };
}

/** A source time on the clip clock, with the marked pauses taken out. Speed 1 leaves the old value. */
export function clipClock(at: number, start: number, pauses: PauseSpan[], speed = 1) {
  const skipped = pauses.reduce(
    (sum, pause) => sum + Math.max(0, Math.min(pause.end, at) - pause.start),
    0,
  );
  const clock = Math.max(0, at - start - skipped);
  return speed === 1 ? clock : clock / speed;
}

/** Where a clip-relative time lands once the pauses are gone. Null means that moment is cut. */
export function keptTime(time: number, kept: [number, number][]) {
  let out = 0;
  for (const [start, end] of kept) {
    if (time < start) return null;
    if (time < end) return out + (time - start);
    out += end - start;
  }
  return null;
}

export function pauseSummary(plan: PausePlan) {
  if (!plan.count) return 'No pauses in this moment';
  const seconds = Math.round(plan.seconds * 10) / 10;
  const label = plan.count === 1 ? 'pause' : 'pauses';
  return `${plan.count} ${label} marked, about ${seconds} s shorter`;
}

/**
 * Peak detector for the browser, where ffmpeg is not available.
 * A sample below -35 dB counts as quiet; a run of at least {@link PAUSE_MIN} seconds is a silence.
 * Desktop export listens with ffmpeg and can disagree by a little.
 */
export function silencesIn(
  samples: Float32Array,
  sampleRate: number,
  channels: number,
  duration: number,
) {
  const meter = new Meter(duration);
  const frames = Math.floor(samples.length / Math.max(1, channels));
  for (let i = 0; i < frames; i++) {
    let peak = 0;
    for (let channel = 0; channel < channels; channel++) {
      const value = Math.abs(samples[i * channels + channel]);
      if (value > peak) peak = value;
    }
    meter.sample(peak, i / sampleRate);
  }
  return meter.finish();
}

class Meter {
  private quietFrom: number | null = null;
  private spans: [number, number][] = [];
  constructor(private duration: number) {}
  sample(peak: number, time: number) {
    if (time < 0 || time >= this.duration) return;
    if (peak < PAUSE_NOISE) {
      if (this.quietFrom === null) this.quietFrom = time;
      return;
    }
    this.close(time);
  }
  private close(time: number) {
    if (this.quietFrom !== null && time - this.quietFrom >= PAUSE_MIN) {
      this.spans.push([this.quietFrom, Math.min(this.duration, time)]);
    }
    this.quietFrom = null;
  }
  finish() {
    if (this.quietFrom !== null) this.close(this.duration);
    return this.spans;
  }
}

type Pcm = {
  timestamp: number;
  numberOfFrames: number;
  numberOfChannels: number;
  sampleRate: number;
  copyTo: (
    dest: Float32Array,
    options: { planeIndex: number; format: 'f32'; frameCount: number },
  ) => void;
  close: () => void;
};

function feed(meter: Meter, sample: Pcm, origin: number) {
  const channels = sample.numberOfChannels;
  const frames = sample.numberOfFrames;
  if (channels < 1 || frames < 1 || !(sample.sampleRate > 0)) return;
  const data = new Float32Array(frames * channels);
  sample.copyTo(data, { planeIndex: 0, format: 'f32', frameCount: frames });
  for (let i = 0; i < frames; i++) {
    let peak = 0;
    for (let channel = 0; channel < channels; channel++) {
      const value = Math.abs(data[i * channels + channel]);
      if (value > peak) peak = value;
    }
    meter.sample(peak, sample.timestamp - origin + i / sample.sampleRate);
  }
}

function cancelled() {
  return new DOMException('The scan was cancelled.', 'AbortError');
}

/** Listen to one cut. Desktop uses ffmpeg; the browser measures the decoded samples. */
export async function scanCut(project: Project, cut: Cut, signal: AbortSignal) {
  const duration = Math.max(0, cut.end - cut.start);
  if (desktop) {
    const found = await invoke<{ cuts: PauseSpan[]; count: number; seconds: number }>(
      'find_pauses',
      { id: project.id, start: cut.start, end: cut.end },
    );
    const seconds = Number.isFinite(found.seconds) ? found.seconds : 0;
    return {
      cuts: Array.isArray(found.cuts) ? found.cuts : [],
      kept: null,
      count: found.count || 0,
      seconds,
      spoken: Math.max(0, duration - seconds),
    } satisfies PausePlan;
  }
  const blob =
    project.id === 'sample'
      ? await (await fetch(project.path, { signal })).blob()
      : await browserBlob(project.id);
  return hearPauses(blob, cut.start, cut.end, signal);
}

/** The browser's own listen, shared by the preview and the WebM export. */
export async function hearPauses(blob: Blob, start: number, end: number, signal: AbortSignal) {
  const duration = end - start;
  if (!(duration > 0)) return emptyPlan(0);
  const { Input, BlobSource, MP4, QTFF, MATROSKA, AudioSampleSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF, MATROSKA] });
  try {
    if (signal.aborted) throw cancelled();
    const track = await input.getPrimaryAudioTrack();
    if (!track) return emptyPlan(duration);
    if (!(await track.canDecode())) {
      throw Error('This browser cannot hear the pauses. Use the desktop app.');
    }
    const meter = new Meter(duration);
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples(start, end)) {
      if (signal.aborted) {
        sample.close();
        throw cancelled();
      }
      feed(meter, sample, start);
      sample.close();
    }
    return planFromSilences(meter.finish(), duration, start);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof Error && error.message.includes('desktop app')) throw error;
    throw Error('This browser cannot hear the pauses. Use the desktop app.');
  } finally {
    input.dispose();
  }
}
