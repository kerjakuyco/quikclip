import { browserBlob, type Project, type Cut } from './studio';

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
  } = await import('mediabunny');
  const blob =
    project.id === 'sample'
      ? await (await fetch(src, { signal })).blob()
      : await browserBlob(project.id);
  const input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF, MATROSKA] });
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const ratio =
    cut.shape === 'vertical' ? 9 / 16 : cut.shape === 'square' ? 1 : project.width / project.height;
  const h = Math.min(project.height, project.width / ratio, 1080);
  let cancel: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      trim: { start: cut.start, end: cut.end },
      video: {
        codec: 'vp8',
        width: Math.max(2, 2 * Math.floor((h * ratio) / 2)),
        height: Math.max(2, 2 * Math.floor(h / 2)),
        fit: 'cover',
      },
      audio: { codec: 'opus', sampleRate: 48000 },
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
    if (cancel) signal.removeEventListener('abort', cancel);
    input.dispose();
  }
}
