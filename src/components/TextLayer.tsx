import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { textFrame, textPreset, textsAt, type TextLayer as Layer } from '../texts';

/**
 * The clip's text layers over the preview, animated as the export draws them. While the clip plays it follows the player
 * on every frame, so a pop or a typed line moves as smoothly here as in the file.
 */
export function TextLayer({
  layers,
  start,
  time,
  playing,
  source,
  width,
  height,
}: {
  layers: readonly Layer[];
  /** The clip's in point. */
  start: number;
  time: number;
  playing: boolean;
  source: RefObject<HTMLVideoElement | null>;
  /** The output frame, in pixels. */
  width: number;
  height: number;
}) {
  const [now, setNow] = useState(time);
  useEffect(() => setNow(time), [time]);
  useEffect(() => {
    if (!playing || !layers.length) return;
    let frame = 0;
    const tick = () => {
      const player = source.current;
      if (player) setNow(player.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, layers.length, source]);
  const showing = textsAt(layers, start, now);
  if (!showing.length) return null;
  const short = Math.min(width, height);
  return (
    <div className="text-layer" aria-hidden="true">
      {showing.map(({ layer, offset }) => {
        const look = textPreset(layer);
        const shape = textFrame(layer, offset);
        const text = layer.text.trim();
        const style = {
          left: `${layer.x * 100}%`,
          top: `${(layer.y + shape.lift) * 100}%`,
          opacity: shape.opacity,
          transform: `translate(-50%, -50%) scale(${shape.scale})`,
          fontSize: `${((look.size * short) / width) * 100}cqw`,
          fontWeight: look.bold ? 800 : 500,
          fontStyle: look.italic ? 'italic' : 'normal',
          '--text-color': layer.color || '#FFFFFF',
        } as CSSProperties;
        return (
          <p
            key={layer.id}
            className={`text-overlay${look.box ? ' boxed' : ''}`}
            style={style}
            data-text={layer.id}
          >
            <span>
              {text.slice(0, shape.letters)}
              <span className="text-unshown">{text.slice(shape.letters)}</span>
            </span>
          </p>
        );
      })}
    </div>
  );
}
