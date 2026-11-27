import { headlineText, paintHeadline } from './headline';
import { logoFit, type LogoCorner } from './logo';
import { musicBed, musicMix, type MusicMix } from './music';
import { hearPauses, keptTime } from './pauses';
import { cutSpeed, VoicePace } from './speed';
import {
  browserBlob,
  browserFrame,
  cropBox,
  splitBand,
  cropFrame,
  cropRect,
  cutCrop,
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
import { cutCam } from './facecam';
import type {
  AudioSample,
  AudioSampleSource,
  ConversionVideoOptions,
  VideoSample,
} from 'mediabunny';

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

/** The split layout: the face band cropped from the source on top, the whole picture on a blurred copy below. */
function paintSplit(
  sample: VideoSample,
  width: number,
  height: number,
  face: { left: number; top: number; width: number; height: number },
  share: number,
) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('This browser cannot draw the split layout.');
  const top = Math.round(height * share);
  const bottom = height - top;
  const sw = sample.displayWidth;
  const sh = sample.displayHeight;
  sample.draw(ctx, face.left, face.top, face.width, face.height, 0, 0, width, top);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, width, bottom);
  ctx.clip();
  ctx.fillStyle = '#09090a';
  ctx.fillRect(0, top, width, bottom);
  const cover = Math.max(width / sw, bottom / sh) * 1.12;
  ctx.filter = 'blur(14px) brightness(0.82)';
  sample.draw(
    ctx,
    (width - sw * cover) / 2,
    top + (bottom - sh * cover) / 2,
    sw * cover,
    sh * cover,
  );
  ctx.filter = 'none';
  const contain = Math.min(width / sw, bottom / sh);
  sample.draw(
    ctx,
    (width - sw * contain) / 2,
    top + (bottom - sh * contain) / 2,
    sw * contain,
    sh * contain,
  );
  ctx.restore();
  sample.close();
  return canvas;
}

/**
 * The stacked layout (facecam.ts): the facecam box, cut to the band's shape around its middle, filling the top, and the
 * gameplay part of the source filling the rest.
 */
function paintStack(
  sample: VideoSample,
  width: number,
  height: number,
  cam: { x: number; y: number; w: number; h: number },
  game: { left: number; top: number; width: number; height: number },
  share: number,
) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('This browser cannot draw the facecam layout.');
  const top = Math.round(height * share);
  const sw = sample.displayWidth;
  const sh = sample.displayHeight;
  let [cw, ch] = [cam.w * sw, cam.h * sh];
  const want = width / top;
  if (cw / ch > want) cw = ch * want;
  else ch = cw / want;
  const cx = cam.x * sw + (cam.w * sw - cw) / 2;
  const cy = cam.y * sh + (cam.h * sh - ch) / 2;
  sample.draw(ctx, cx, cy, cw, ch, 0, 0, width, top);
  sample.draw(ctx, game.left, game.top, game.width, game.height, 0, top, width, height - top);
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

/** Mix in place at preview levels. Desktop export also normalizes the mixed loudness. */
function soundtrack(buffer: AudioBuffer, settings: MusicMix, length: number) {
  const lanes = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
  return (data: Float32Array, channels: number, rate: number, time: number) => {
    const frames = data.length / channels;
    for (let i = 0; i < frames; i++) {
      const at = musicBed(time + i / rate, settings, buffer.duration, length);
      for (let c = 0; c < channels; c++) {
        let add = 0;
        if (at.position !== null && at.volume > 0) {
          const pos = at.position * buffer.sampleRate;
          const index = Math.floor(pos);
          const lane = lanes[Math.min(c, lanes.length - 1)];
          const left = lane[index] ?? 0;
          const right = lane[index + 1] ?? left;
          add = (left + (right - left) * (pos - index)) * at.volume;
        }
        const index = i * channels + c;
        data[index] = Math.max(-1, Math.min(1, data[index] * settings.source_volume + add));
      }
    }
  };
}

function mixUnder(
  make: typeof AudioSample,
  sample: AudioSample,
  mix: ReturnType<typeof soundtrack>,
) {
  const frames = sample.numberOfFrames;
  const channels = sample.numberOfChannels;
  const data = new Float32Array(frames * channels);
  sample.copyTo(data, { planeIndex: 0, format: 'f32', frameCount: frames });
  mix(data, channels, sample.sampleRate, sample.timestamp);
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

/** A silent source needs its own output audio track. Write bounded blocks, not a clip-sized buffer. */
async function writeSoundtrack(
  make: typeof AudioSample,
  track: AudioSampleSource,
  mix: ReturnType<typeof soundtrack>,
  length: number,
  signal: AbortSignal,
) {
  const sampleRate = 48000;
  const channels = 2;
  const total = Math.round(length * sampleRate);
  for (let written = 0; written < total; written += 4800) {
    signal.throwIfAborted();
    const data = new Float32Array(Math.min(4800, total - written) * channels);
    const timestamp = written / sampleRate;
    mix(data, channels, sampleRate, timestamp);
    const sample = new make({
      data,
      format: 'f32',
      numberOfChannels: channels,
      sampleRate,
      timestamp,
    });
    try {
      await track.add(sample);
    } finally {
      sample.close();
    }
  }
  track.close();
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
    WEBM,
    Output,
    WebMOutputFormat,
    BufferTarget,
    Conversion,
    AudioSample,
    AudioSampleSource,
    VideoSample,
  } = await import('mediabunny');
  const blob =
    project.id === 'sample'
      ? await (await fetch(src, { signal })).blob()
      : await browserBlob(project.id);
  const blur = cut.shape !== 'source' && cutFit(cut) === 'blur';
  const split = cut.shape !== 'source' && cutFit(cut) === 'split';
  const stack = cut.shape !== 'source' && cutFit(cut) === 'stack';
  const cam = cutCam(cut, project.width, project.height);
  const crop = cropFrame(cut, project.width, project.height);
  const box = cropBox(cut, project.width, project.height);
  const face = cropRect(box, cutCrop(cut), project.width, project.height);
  const { width, height } = browserFrame(crop);
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
  const mix = music && bed ? soundtrack(bed, musicMix(music, bed.duration), length) : null;
  const input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF, MATROSKA, WEBM] });
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
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
    const bedTrack =
      mix && !(await input.getPrimaryAudioTrack())
        ? new AudioSampleSource({ codec: 'opus', bitrate: 128000 })
        : null;
    if (bedTrack) {
      output.addAudioTrack(bedTrack);
      output.setMetadataTags({ title: cut.title });
    }
    signal.throwIfAborted();
    const draw = Boolean(blur || split || stack || text || mark);
    const decorate = (canvas: OffscreenCanvas) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw Error(
          text || !mark
            ? 'This browser cannot draw the headline.'
            : 'This browser cannot draw the logo.',
        );
      }
      if (text) paintHeadline(ctx, width, height, text);
      if (mark && logo) paintLogo(ctx, width, height, mark, logo.corner);
      return canvas;
    };
    const video: ConversionVideoOptions = { codec: 'vp8' };
    if (!blur && !split && !stack) {
      // Crop in source pixels before resizing, including when overlays or speed are enabled.
      Object.assign(video, { width, height, fit: 'fill' });
      if (cut.shape !== 'source') video.crop = crop;
    }
    if (draw) {
      video.processedWidth = width;
      video.processedHeight = height;
    }
    if (draw || kept || pace !== 1) {
      video.process = (sample) => {
        const at = kept ? keptTime(sample.timestamp, kept) : sample.timestamp;
        if (at === null) {
          sample.close();
          return null;
        }
        const duration = sample.duration / pace;
        if (!draw) {
          sample.setTimestamp(at / pace);
          if (pace !== 1) sample.setDuration(duration);
          return sample;
        }
        const canvas = decorate(
          blur
            ? paintBlur(sample, width, height)
            : split
              ? paintSplit(sample, width, height, face, box.height / crop.height)
              : stack
                ? paintStack(sample, width, height, cam, face, splitBand(crop.height) / crop.height)
                : drawFrame(sample, width, height),
        );
        return new VideoSample(canvas, { timestamp: at / pace, duration });
      };
    }
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      trim: { start: cut.start, end: cut.end },
      video,
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
                    return mix ? mixUnder(AudioSample, voiced, mix) : voiced;
                  });
                  return mixed.length === 1 ? mixed[0] : mixed;
                },
              }
            : voice || mix
              ? {
                  codec: 'opus',
                  sampleRate: 48000,
                  process: (sample) => {
                    const voiced = voice ? highpass90(AudioSample, sample, ears) : sample;
                    return mix ? mixUnder(AudioSample, voiced, mix) : voiced;
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
                  return mix ? mixUnder(AudioSample, voiced, mix) : voiced;
                });
                return mixed.length === 1 ? mixed[0] : mixed;
              },
            },
      ...(bedTrack ? { composable: true } : { tags: { title: cut.title } }),
    });
    if (!conversion.isValid || conversion.discardedTracks.length) {
      throw Error(
        'This browser cannot transcode all source tracks. Use the desktop app to export MP4.',
      );
    }
    signal.throwIfAborted();
    cancel = () => {
      void conversion.cancel().catch(() => {});
      if (bedTrack) void output.cancel().catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    conversion.onProgress = progress;
    if (bedTrack && mix) {
      await output.start();
      await Promise.all([
        conversion.execute(),
        writeSoundtrack(AudioSample, bedTrack, mix, length, signal),
      ]);
      signal.throwIfAborted();
      await output.finalize();
    } else {
      await conversion.execute();
    }
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
  } catch (error) {
    cancel?.();
    throw error;
  } finally {
    mark?.close();
    if (cancel) signal.removeEventListener('abort', cancel);
    input.dispose();
  }
}
