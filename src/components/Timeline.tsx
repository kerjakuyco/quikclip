import { useRef, type PointerEvent } from 'react';
import { AudioLines, Film, ListVideo, Plus, Scissors } from 'lucide-react';
import { asset, clock, desktop, frame, type Cut, type Project } from '../studio';

export function Timeline({
  p,
  cut,
  time,
  seek,
  trim,
  add,
}: {
  p: Project;
  cut: Cut;
  time: number;
  seek: (n: number) => void;
  trim: (which: 'start' | 'end', n: number) => void;
  add: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'start' | 'end' | 'seek'; offset: number } | null>(null);
  const clipIndex = p.cuts.findIndex((item) => item.id === cut.id) + 1;
  const selection = ((cut.end - cut.start) / p.duration) * 100;
  const toTime = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return ((x - r.left) / r.width) * p.duration;
  };
  const move = (x: number) => {
    const active = drag.current;
    if (!active) return;
    const n = toTime(x) + active.offset;
    if (active.mode === 'seek') seek(n);
    else trim(active.mode, n);
  };
  function down(e: PointerEvent<HTMLElement>, mode: 'start' | 'end' | 'seek') {
    if (!e.isPrimary || e.button !== 0) return;
    e.stopPropagation();
    drag.current = { mode, offset: mode === 'seek' ? 0 : cut[mode] - toTime(e.clientX) };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (mode === 'seek') move(e.clientX);
  }
  const finish = () => {
    drag.current = null;
  };
  return (
    <section className="timeline" aria-labelledby="timeline-title">
      <div className="panel-heading">
        <h2 id="timeline-title">
          <ListVideo />
          Timeline
        </h2>
        <button className="btn secondary timeline-add" onClick={add}>
          <Plus size={14} /> Add clip
        </button>
      </div>
      <div className="timeline-body">
        <div className="track-labels" aria-hidden="true">
          <span className="track-ruler-label">Timecode</span>
          <span title="Video track">
            <Film size={15} />
            <span>Video</span>
            <small>V1</small>
          </span>
          <span title="Audio track">
            <AudioLines size={15} />
            <span>Audio</span>
            <small>A1</small>
          </span>
        </div>
        <div
          className="tracks"
          ref={track}
          onPointerDown={(e) => down(e, 'seek')}
          onPointerMove={(e) => move(e.clientX)}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
        >
          <div className="ruler" aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} style={{ left: `${(i / 6) * 100}%` }}>
                {clock((p.duration * i) / 6)}
              </span>
            ))}
          </div>
          <div className="filmstrip" aria-hidden="true">
            {Array.from({ length: 15 }, (_, i) => {
              const thumbnail = frame(p, (p.duration * i) / 15);
              return (
                <div
                  key={i}
                  style={thumbnail ? { backgroundImage: `url("${thumbnail}")` } : undefined}
                />
              );
            })}
          </div>
          <div className="audio-track">
            {p.wave ? (
              <img src={asset(p, p.wave)} draggable={false} alt="Source audio waveform" />
            ) : desktop && p.id !== 'sample' && p.wave === undefined ? (
              <span role="status">Drawing the audio waveform…</span>
            ) : (
              <span>Waveform unavailable</span>
            )}
          </div>
          <div
            className="cut-selection"
            style={{
              left: `${(cut.start / p.duration) * 100}%`,
              width: `${selection}%`,
            }}
          >
            {selection >= 15 && (
              <span className="selection-label" aria-hidden="true">
                <b>{String(clipIndex).padStart(2, '0')}</b>
                <span>{cut.title}</span>
              </span>
            )}
            {(['start', 'end'] as const).map((k) => (
              <button
                key={k}
                aria-label={`Drag clip ${k}`}
                title={`Adjust ${k} (arrow keys)`}
                className={`handle ${k}`}
                onPointerDown={(e) => down(e, k)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    trim(k, cut[k] + (e.key === 'ArrowLeft' ? -0.1 : 0.1));
                  }
                }}
              >
                <i />
              </button>
            ))}
          </div>
          <div className="playhead" style={{ left: `${(time / p.duration) * 100}%` }}>
            <i />
          </div>
        </div>
      </div>
      <div className="timeline-foot">
        <span>
          <i className="legend-square" aria-hidden="true" /> Selected range
        </span>
        <span className="timeline-hint">Drag handles to trim · Click the track to seek</span>
        <span className="timeline-duration">
          <Scissors size={12} />
          <b>{clock(cut.end - cut.start, true)}</b>
          <span>selected</span>
        </span>
      </div>
    </section>
  );
}
