import { useEffect, useRef, useState } from 'react';
import { brollAt, type BRoll } from '../broll';
import { asset, browserBlob, desktop, mediaOf, type Project } from '../studio';

/** A project video's playable address: a file on the desktop, the bundled sample, or a stored browser copy. */
function useVideoUrl(p: Project, video: string) {
  const media = mediaOf(p, video === p.id ? null : { video });
  const direct = media.id === 'sample' || desktop ? (asset(media, media.path) ?? '') : '';
  const [blob, setBlob] = useState('');
  useEffect(() => {
    if (direct) return;
    let alive = true;
    let url = '';
    browserBlob(media.id)
      .then((file) => {
        if (!alive) return;
        url = URL.createObjectURL(file);
        setBlob(url);
      })
      .catch(() => setBlob(''));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [direct, media.id]);
  return direct || blob;
}

function Shot({
  p,
  shot,
  offset,
  playing,
}: {
  p: Project;
  shot: BRoll;
  offset: number;
  playing: boolean;
}) {
  const url = useVideoUrl(p, shot.video);
  const player = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = player.current;
    if (!v || v.readyState < 1) return;
    const target = shot.from + offset;
    if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
    if (playing && v.paused) void v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
  }, [shot.from, offset, playing, url]);
  if (!url) return null;
  return (
    <video
      ref={player}
      className={
        shot.mode === 'pip' ? `broll-pip broll-${shot.corner ?? 'top-right'}` : 'broll-cutaway'
      }
      src={url}
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      data-broll={shot.id}
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = shot.from + offset;
      }}
    />
  );
}

/** The clip's b-roll over the preview, each shot playing in step with the clip while it shows. */
export function BrollLayer({
  p,
  shots,
  start,
  time,
  playing,
}: {
  p: Project;
  shots: readonly BRoll[];
  /** The clip's in point. */
  start: number;
  time: number;
  playing: boolean;
}) {
  const showing = brollAt(shots, start, time);
  if (!showing.length) return null;
  return (
    <div className="broll-layer">
      {showing.map(({ shot, offset }) => (
        <Shot key={shot.id} p={p} shot={shot} offset={offset} playing={playing} />
      ))}
    </div>
  );
}
