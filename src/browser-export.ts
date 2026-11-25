import { headlineText, paintHeadline } from './headline';
import { logoFit, type LogoCorner } from './logo';
import { musicBed, type MusicSettings } from './music';
import { hearPauses, keptTime } from './pauses';
import { cutSpeed, VoicePace } from './speed';
import {
  browserBlob,
  cutFit,
  cutLogo,
  cutMusic,
  cutPauses,
  cutVoice,
  logoBlob,
  musicBlob,
  type Project,
  type Cut,
} from './studio';
import type { AudioSample, VideoSample } from 'mediabunny';

/** Whole picture on a darkened blurred fill. The cover is drawn larger so the blur stays inside the frame. */
function paintBlur(sample: VideoSample, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('This browser cannot draw the blurred fill.');
  const sw = sample.displayWidth;
  const sh = sample.displayHeight;
  ctx.fillStyle = '#09090a';
  ctx.fillRect(0, 0, width, height);
  const cover = Math.max(width / sw, height / sh) * 1.12;
  ctx.filter = 'blur(14px) brightness(0.82)';
  sample.draw(ctx, (width - sw * cover) / 2, (height - sh * cover) / 2, sw * cover, sh * cover);
  ctx.filter = 'none';
  const contain = Math.min(width / sw, height / sh);
  sample.draw(
    ctx,
    (width - sw * contain) / 2,
    (height - sh * contain) / 2,
    sw * contain,
    sh * contain,
  );
  sample.close();
  return canvas;
}

/** The logo, fitted the way clip-ai scales it into `logo_place`. */
function paintLogo(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  mark: ImageBitmap,
  corner: LogoCorner,
) {
  const fit = logoFit(width, height, mark.width, mark.height, corner);
  ctx.drawImage(mark, fit.fitX, fit.fitY, fit.fitWidth, fit.fitHeight);
}

async function loadMark(blob: Blob) {
  if (typeof createImageBitmap !== 'function') {
    throw Error('This browser cannot draw the logo. Use the desktop app.');
  }
  try {
    return await createImageBitmap(blob);
  } catch {
    throw Error('Use a PNG logo, ideally with a transparent background.');
  }
}

/** A frame already fitted by the converter, copied so a headline can be drawn on it. */
function drawFrame(sample: VideoSample, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('This browser cannot draw the frame.');
  sample.draw(ctx, 0, 0, width, height);
  sample.close();
  return canvas;
}

type Ears = { x1: number; x2: number; y1: number; y2: number };

/** 2-pole high-pass at 90 Hz, the browser stand-in for FFmpeg `highpass=f=90`. */
function highpass90(
  make: new (init: {
    data: Float32Array;
    format: 'f32';
    numberOfChannels: number;
    sampleRate: number;
    timestamp: number;
  }) => AudioSample,
  sample: AudioSample,
  state: Ears[],
) {
  const frames = sample.numberOfFrames;
  const channels = sample.numberOfChannels;
  const data = new Float32Array(frames * channels);
  sample.copyTo(data, { planeIndex: 0, format: 'f32', frameCount: frames });
  const w0 = (2 * Math.PI * 90) / sample.sampleRate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const b0 = (1 + cos) / 2;
  const b1 = -(1 + cos);
  const b2 = (1 + cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  for (let c = 0; c < channels; c++) {
    const memory = (state[c] ??= { x1: 0, x2: 0, y1: 0, y2: 0 });
    for (let i = 0; i < frames; i++) {
      const x = data[i * channels + c];
      const y =
        (b0 / a0) * x +
        (b1 / a0) * memory.x1 +
        (b2 / a0) * memory.x2 -
        (a1 / a0) * memory.y1 -
        (a2 / a0) * memory.y2;
      memory.x2 = memory.x1;
      memory.x1 = x;
      memory.y2 = memory.y1;
      memory.y1 = y;
      data[i * channels + c] = y;
    }
  }
  const next = new make({
    data,
    format: 'f32',
    numberOfChannels: channels,
    sampleRate: sample.sampleRate,
    timestamp: sample.timestamp,
  });
  sample.close();
  return next;
}

/** The desktop export evens the mixed level with loudnorm. Here the track is added at the preview level. */
function mixUnder(
  make: new (init: {
    data: Float32Array;
    format: 'f32';
    numberOfChannels: number;
    sampleRate: number;
    timestamp: number;
  }) => AudioSample,
  sample: AudioSample,
  buffer: AudioBuffer,
  music: MusicSettings,
  length: number,
) {
  const frames = sample.numberOfFrames;
  const channels = sample.numberOfChannels;
  const data = new Float32Array(frames * channels);
  sample.copyTo(data, { planeIndex: 0, format: 'f32', frameCount: frames });
  const lanes = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
  const musicRate = buffer.sampleRate;
  for (let i = 0; i < frames; i++) {
    const at = musicBed(sample.timestamp + i / sample.sampleRate, music, buffer.duration, length);
    for (let c = 0; c < channels; c++) {
      let add = 0;
      if (at.position !== null && at.volume > 0) {
        const pos = at.position * musicRate;
        const index = Math.floor(pos);
        const frac = pos - index;
        const lane = lanes[buffer.numberOfChannels === 1 ? 0 : Math.min(c, lanes.length - 1)];
        const left = lane[index] ?? 0;
        const right = lane[index + 1] ?? left;
        add = (left + (right - left) * frac) * at.volume;
      }
      const mixed = data[i * channels + c] + add;
      data[i * channels + c] = mixed < -1 ? -1 : mixed > 1 ? 1 : mixed;
    }
  }
  const next = new make({
    data,
    format: 'f32',
    numberOfChannels: channels,
    sampleRate: sample.sampleRate,
    timestamp: sample.timestamp,
  });
  sample.close();
  return next;
}

async function decodeBed(blob: Blob) {
  if (typeof AudioContext === 'undefined')
    throw Error('This browser cannot mix the music. Use the desktop app.');
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw Error('That file has no sound we can read.');
  } finally {
    await context.close();
  }
}

/** Encode from source timestamps, independent of playback and display refresh. */
export async function exportWeb(
  src: string,
  project: Project,
  cut: Cut,
  signal: AbortSignal,
  progress: (p: number) => void,
) {
  if (!('VideoEncoder' in window))
    throw Error('WebCodecs is unavailable here. Open the desktop app for MP4 export.');
  const {
    Input,
    BlobSource,
    MATROSKA,
    MP4,
    QTFF,
    Output,
    WebMOutputFormat,
    BufferTarget,
    Conversion,
    AudioSample,
    VideoSample,
  } = await import('mediabunny');
  const blob =
    project.id === 'sample'
      ? await (await fetch(src, { signal })).blob()
      : await browserBlob(project.id);
  const input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF, MATROSKA] });
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const ratio =
    cut.shape === 'vertical' ? 9 / 16 : cut.shape === 'square' ? 1 : project.width / project.height;
  const blur = cut.shape !== 'source' && cutFit(cut) === 'blur';
  const text = headlineText(cut.headline);
  const voice = cutVoice(cut);
  const music = cutMusic(cut);
  const logo = cutLogo(cut);
  const bed = music ? await decodeBed(await musicBlob(music.source)) : null;
  const heard = cutPauses(cut) ? await hearPauses(blob, cut.start, cut.end, signal) : null;
  const kept = heard?.kept ?? null;
  const pace = cutSpeed(cut);
  const spoken = heard && heard.kept ? heard.spoken : cut.end - cut.start;
  const length = pace === 1 ? spoken : spoken / pace;
  const h = Math.min(project.height, project.width / ratio, 1080);
  const width = Math.max(2, 2 * Math.floor((h * ratio) / 2));
  const height = Math.max(2, 2 * Math.floor(h / 2));
  const ears: Ears[] = [];
  const voicePace = new VoicePace();
  let cancel: (() => void) | undefined;
  let mark: ImageBitmap | null = null;
  const sliceKept = (sample: AudioSample, spans: [number, number][]) => {
    const t0 = sample.timestamp;
    const t1 = t0 + sample.duration;
    const rate = sample.sampleRate;
    const total = sample.numberOfFrames;
    const pieces: AudioSample[] = [];
    let outputAt = 0;
    for (const [start, end] of spans) {
      const from = Math.max(t0, start);
      const to = Math.min(t1, end);
      if (to > from) {
        const startFrame = Math.max(0, Math.min(total, Math.round((from - t0) * rate)));
        const endFrame = Math.max(0, Math.min(total, Math.round((to - t0) * rate)));
        if (endFrame > startFrame) {
          const piece = sample.trim(startFrame, endFrame);
          piece.setTimestamp(Math.max(0, outputAt + (from - start)));
          pieces.push(piece);
        }
      }
      outputAt += end - start;
    }
    sample.close();
    return pieces;
  };
  try {
    if (logo) mark = await loadMark(await logoBlob(logo.source));
    signal.throwIfAborted();
    const draw = Boolean(blur || text || mark);
    const decorate = (canvas: OffscreenCanvas) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw Error(
          text || !mark
            ? 'This browser cannot draw the headline.'
            : 'This browser cannot draw the logo.',
        );
      }
      if (text) paintHeadline(ctx, cut.shape, width, height, text);
      if (mark && logo) paintLogo(ctx, width, height, mark, logo.corner);
      return canvas;
    };
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      trim: { start: cut.start, end: cut.end },
      video:
        pace === 1
          ? kept
            ? {
                codec: 'vp8',
                ...(draw
                  ? {
                      ...(blur ? {} : { width, height, fit: 'cover' as const }),
                      processedWidth: width,
                      processedHeight: height,
                    }
                  : { width, height, fit: 'cover' as const }),
                process: (sample) => {
                  const at = keptTime(sample.timestamp, kept);
                  const frameDuration = sample.duration;
                  if (at === null) {
                    sample.close();
                    return null;
                  }
                  if (!draw) {
                    sample.setTimestamp(at);
                    return sample;
                  }
                  const canvas = decorate(
                    blur ? paintBlur(sample, width, height) : drawFrame(sample, width, height),
                  );
                  return new VideoSample(canvas, { timestamp: at, duration: frameDuration });
                },
              }
            : draw
              ? {
                  codec: 'vp8',
                  ...(blur ? {} : { width, height, fit: 'cover' as const }),
                  processedWidth: width,
                  processedHeight: height,
                  process: (sample) =>
                    decorate(
                      blur ? paintBlur(sample, width, height) : drawFrame(sample, width, height),
                    ),
                }
              : {
                  codec: 'vp8',
                  width,
                  height,
                  fit: 'cover',
                }
          : {
              codec: 'vp8' as const,
              ...(draw && blur ? {} : { width, height, fit: 'cover' as const }),
              ...(draw ? { processedWidth: width, processedHeight: height } : {}),
              process: (sample) => {
                const frameDuration = sample.duration;
                const at = kept ? keptTime(sample.timestamp, kept) : sample.timestamp;
                if (at === null) {
                  sample.close();
                  return null;
                }
                if (!draw) {
                  sample.setTimestamp(at / pace);
                  sample.setDuration(frameDuration / pace);
                  return sample;
                }
                const canvas = decorate(
                  blur ? paintBlur(sample, width, height) : drawFrame(sample, width, height),
                );
                return new VideoSample(canvas, {
                  timestamp: at / pace,
                  duration: frameDuration / pace,
                });
              },
            },
      audio:
        pace === 1
          ? kept
            ? {
                codec: 'opus',
                sampleRate: 48000,
                process: (sample) => {
                  const pieces = sliceKept(sample, kept);
                  if (!pieces.length) return null;
                  const mixed = pieces.map((piece) => {
                    const voiced = voice ? highpass90(AudioSample, piece, ears) : piece;
                    return bed && music
                      ? mixUnder(AudioSample, voiced, bed, music, length)
                      : voiced;
                  });
                  return mixed.length === 1 ? mixed[0] : mixed;
                },
              }
            : voice || bed
              ? {
                  codec: 'opus',
                  sampleRate: 48000,
                  process: (sample) => {
                    const voiced = voice ? highpass90(AudioSample, sample, ears) : sample;
                    return bed && music
                      ? mixUnder(AudioSample, voiced, bed, music, length)
                      : voiced;
                  },
                }
              : { codec: 'opus', sampleRate: 48000 }
          : {
              codec: 'opus' as const,
              sampleRate: 48000,
              process: (sample) => {
                const pieces = kept ? sliceKept(sample, kept) : [sample];
                const paced = pieces.flatMap((piece) => {
                  const frames = piece.numberOfFrames;
                  const channels = piece.numberOfChannels;
                  const data = new Float32Array(frames * channels);
                  piece.copyTo(data, { planeIndex: 0, format: 'f32', frameCount: frames });
                  const at = piece.timestamp;
                  const rate = piece.sampleRate;
                  piece.close();
                  return voicePace.push(data, channels, rate, at, pace);
                });
                if (!paced.length) return null;
                const mixed = paced.map((piece) => {
                  const made = new AudioSample({
                    data: piece.data,
                    format: 'f32',
                    numberOfChannels: piece.channels,
                    sampleRate: piece.rate,
                    timestamp: piece.timestamp,
                  });
                  const voiced = voice ? highpass90(AudioSample, made, ears) : made;
                  return bed && music ? mixUnder(AudioSample, voiced, bed, music, length) : voiced;
                });
                return mixed.length === 1 ? mixed[0] : mixed;
              },
            },
      tags: { title: cut.title },
    });
    if (!conversion.isValid || conversion.discardedTracks.length) {
      throw Error(
        'This browser cannot transcode all source tracks. Use the desktop app to export MP4.',
      );
    }
    signal.throwIfAborted();
    cancel = () => {
      void conversion.cancel();
    };
    signal.addEventListener('abort', cancel, { once: true });
    conversion.onProgress = progress;
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer?.byteLength) throw Error('The encoder produced an empty clip.');
    const name = `${cut.title.replace(/[^\p{L}\p{N} -]/gu, '_')}.webm`;
    const url = URL.createObjectURL(new Blob([buffer], { type: 'video/webm' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return name;
  } finally {
    mark?.close();
    if (cancel) signal.removeEventListener('abort', cancel);
    input.dispose();
  }
}
