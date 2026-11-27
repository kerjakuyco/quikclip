import { useEffect, useRef, type RefObject } from 'react';

/**
 * The whole picture of the preview's video, drawn again in a second place: the lower part of the split layout. It copies
 * the one player on every frame while it plays and after each seek, so the two parts never drift apart.
 */
export function MirrorVideo({
  source,
  playing,
  time,
  region,
}: {
  source: RefObject<HTMLVideoElement | null>;
  playing: boolean;
  /** The playhead, so a paused seek draws the new frame. */
  time: number;
  /** A box of the picture (shares of it) to fill the canvas with instead, as the facecam's band does. */
  region?: { x: number; y: number; w: number; h: number };
}) {
  const [rx, ry, rw, rh] = region ? [region.x, region.y, region.w, region.h] : [0, 0, 0, 0];
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const player = source.current;
    const draw = () => {
      const target = canvas.current;
      const ctx = target?.getContext('2d');
      if (!target || !ctx || !player || player.readyState < 2 || !player.videoWidth) return;
      const scale = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(2, Math.round(target.clientWidth * scale));
      const height = Math.max(2, Math.round(target.clientHeight * scale));
      if (target.width !== width) target.width = width;
      if (target.height !== height) target.height = height;
      ctx.clearRect(0, 0, width, height);
      if (rw > 0 && rh > 0) {
        // The box, cut to the canvas's shape around its middle, filling it (FFmpeg's cover-scale and crop).
        let [sw, sh] = [rw * player.videoWidth, rh * player.videoHeight];
        const want = width / height;
        if (sw / sh > want) sw = sh * want;
        else sh = sw / want;
        const sx = rx * player.videoWidth + (rw * player.videoWidth - sw) / 2;
        const sy = ry * player.videoHeight + (rh * player.videoHeight - sh) / 2;
        ctx.drawImage(player, sx, sy, sw, sh, 0, 0, width, height);
        return;
      }
      const fit = Math.min(width / player.videoWidth, height / player.videoHeight);
      const w = player.videoWidth * fit;
      const h = player.videoHeight * fit;
      ctx.drawImage(player, (width - w) / 2, (height - h) / 2, w, h);
    };
    draw();
    player?.addEventListener('seeked', draw);
    player?.addEventListener('loadeddata', draw);
    let frame = 0;
    if (playing) {
      const tick = () => {
        draw();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(frame);
      player?.removeEventListener('seeked', draw);
      player?.removeEventListener('loadeddata', draw);
    };
  }, [source, playing, time, rx, ry, rw, rh]);
  return <canvas ref={canvas} className="stage-mirror" aria-hidden="true" />;
}
