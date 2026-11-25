/**
 * Clip speed from clip-ai `clip_speed` and the studio's Video tab: 1×, 1.1×, 1.25×, or 1.5×.
 * 1× is not stored, so a cut from before this field keeps its old length.
 */
export const SPEEDS = [1, 1.1, 1.25, 1.5] as const;
export type Speed = (typeof SPEEDS)[number];

export function cutSpeed(cut: { speed?: number | null }): Speed {
  const speed = cut.speed;
  return speed === 1.1 || speed === 1.25 || speed === 1.5 ? speed : 1;
}

/** How long the clip plays. Speed 1 leaves the span, minus any pauses, unchanged. */
export function playedLength(span: number, removed: number, speed: number) {
  const spoken = Math.max(0, span - Math.max(0, removed));
  const pace = cutSpeed({ speed });
  return pace === 1 ? spoken : spoken / pace;
}

const WINDOW_S = 0.02;
const SEARCH_S = 0.005;

function hann(length: number) {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, length - 1)));
  }
  return window;
}

export type PacedAudio = {
  data: Float32Array;
  timestamp: number;
  channels: number;
  rate: number;
};

/**
 * Streaming stand-in for FFmpeg `atempo`: overlap-add that shortens the voice and keeps its pitch.
 * A hop stays in the buffer until the next one can overlap it, so the last ~20 ms of a clip is left
 * for the following chunk. There is no flush at the end of an export.
 */
export class VoicePace {
  private pending = new Float32Array(0);
  private channels = 1;
  private rate = 48000;
  private speed = 1;
  private inAt = 0;
  private outAt = 0;
  private primed = false;
  /** Absolute input frame where the next grain should sit. The search may nudge it, but the grid does not drift. */
  private ideal = 0;
  /** Absolute input frame of `pending[0]`. */
  private origin = 0;
  private win = 0;
  private hs = 0;
  private ha = 0;
  private delta = 0;
  private window = new Float32Array(0);
  private tail = new Float32Array(0);
  private weight = new Float32Array(0);

  push(
    interleaved: Float32Array,
    channels: number,
    rate: number,
    timestamp: number,
    speed: number,
  ): PacedAudio[] {
    if (!(speed > 1) || !Number.isFinite(speed) || channels < 1 || !(rate > 0)) {
      return interleaved.length ? [{ data: interleaved, timestamp, channels, rate }] : [];
    }
    const pendingFrames = this.pending.length / Math.max(1, this.channels);
    const expected = this.inAt + pendingFrames / Math.max(1, this.rate);
    const gap =
      this.pending.length > 0 &&
      (Math.abs(timestamp - expected) > 0.08 ||
        this.channels !== channels ||
        this.rate !== rate ||
        this.speed !== speed);
    if (!gap && this.pending.length) {
      this.append(interleaved);
      return this.drain(channels, rate);
    }
    const prior = gap ? this.drain(this.channels, this.rate) : [];
    this.begin(timestamp, channels, rate, speed);
    this.append(interleaved);
    return prior.concat(this.drain(channels, rate));
  }

  private begin(timestamp: number, channels: number, rate: number, speed: number) {
    this.pending = new Float32Array(0);
    this.channels = channels;
    this.rate = rate;
    this.speed = speed;
    this.inAt = timestamp;
    this.outAt = timestamp / speed;
    this.primed = false;
    this.ideal = 0;
    this.origin = 0;
    this.win = Math.max(16, Math.round(rate * WINDOW_S));
    if (this.win % 2) this.win += 1;
    this.hs = this.win >> 1;
    this.ha = Math.max(1, Math.round(this.hs * speed));
    this.delta = Math.max(1, Math.round(rate * SEARCH_S));
    this.window = hann(this.win);
    this.tail = new Float32Array(this.win * channels);
    this.weight = new Float32Array(this.win);
  }

  private append(interleaved: Float32Array) {
    if (!interleaved.length) return;
    if (!this.pending.length) {
      this.pending = interleaved.slice();
      return;
    }
    const next = new Float32Array(this.pending.length + interleaved.length);
    next.set(this.pending);
    next.set(interleaved, this.pending.length);
    this.pending = next;
  }

  private frames() {
    return this.pending.length / this.channels;
  }

  private drop(frames: number) {
    if (frames <= 0) return;
    const start = frames * this.channels;
    const next = new Float32Array(this.pending.length - start);
    next.set(this.pending.subarray(start));
    this.pending = next;
    this.inAt += frames / this.rate;
  }

  private overlapAdd(ana: number) {
    const channels = this.channels;
    for (let i = 0; i < this.win; i++) {
      const gain = this.window[i];
      this.weight[i] += gain;
      const src = (ana + i) * channels;
      const dst = i * channels;
      for (let c = 0; c < channels; c++) this.tail[dst + c] += this.pending[src + c] * gain;
    }
  }

  private best(natural: number) {
    const room = this.frames() - this.win;
    const start = Math.max(0, natural - this.delta);
    const end = Math.min(room, natural + this.delta);
    const overlap = this.win - this.hs;
    const channels = this.channels;
    let bestPos = Math.min(natural, room);
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let cand = start; cand <= end; cand++) {
      let score = 0;
      for (let i = 0; i < overlap; i++) {
        score += this.pending[(this.hs + i) * channels] * this.pending[(cand + i) * channels];
      }
      if (score > bestScore) {
        bestScore = score;
        bestPos = cand;
      }
    }
    return bestPos;
  }

  private take(count: number) {
    const channels = this.channels;
    const out = new Float32Array(count * channels);
    for (let i = 0; i < count; i++) {
      const gain = this.weight[i];
      const scale = gain > 1e-8 ? 1 / gain : 0;
      for (let c = 0; c < channels; c++) {
        out[i * channels + c] = this.tail[i * channels + c] * scale;
      }
    }
    this.tail.copyWithin(0, count * channels);
    this.tail.fill(0, (this.win - count) * channels);
    this.weight.copyWithin(0, count);
    this.weight.fill(0, this.win - count);
    return out;
  }

  private drain(channels: number, rate: number): PacedAudio[] {
    if (!this.win || this.channels !== channels) return [];
    const parts: Float32Array[] = [];
    const stamp = this.outAt;
    while (this.frames() >= this.win) {
      if (!this.primed) {
        this.overlapAdd(0);
        this.primed = true;
        this.ideal = this.ha;
        this.origin = 0;
        continue;
      }
      const natural = this.ideal - this.origin;
      if (natural < 1 || this.frames() < natural + this.win) break;
      let ana = this.best(natural);
      if (ana < 1) ana = natural;
      parts.push(this.take(this.hs));
      this.overlapAdd(ana);
      this.drop(ana);
      this.origin += ana;
      this.ideal += this.ha;
    }
    if (!parts.length) return [];
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const data = new Float32Array(length);
    let at = 0;
    for (const part of parts) {
      data.set(part, at);
      at += part.length;
    }
    const paced = { data, timestamp: stamp, channels, rate };
    this.outAt += data.length / channels / rate;
    return [paced];
  }
}
