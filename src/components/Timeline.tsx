import { useRef, type PointerEvent } from 'react';
import { AudioLines, Film, ListVideo, Plus, Scissors } from 'lucide-react';
import { asset, clamp, clock, frame, type Cut, type Project } from '../studio';

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
  const drag = useRef<'start' | 'end' | 'seek' | null>(null);
  const toTime = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return clamp((x - r.left) / r.width, 0, 1) * p.duration;
  };
  const move = (x: number) => {
    if (!drag.current) return;
    const n = toTime(x);
    if (drag.current === 'seek') seek(n);
    else trim(drag.current, n);
  };
  function down(e: PointerEvent<HTMLElement>, mode: typeof drag.current) {
    e.stopPropagation();
    drag.current = mode;
    e.currentTarget.setPointerCapture(e.pointerId);
    move(e.clientX);
  }
  const finish = () => {
    drag.current = null;
  };
  return (
    <section className="panel timeline">
      <div className="panel-heading">
        <h2>
          <ListVideo />
          Timeline
        </h2>
        <button className="text-btn" onClick={add}>
          <Plus size={14} /> Add clip
        </button>
      </div>
      <div className="timeline-body">
        <div className="track-labels">
          <span />
          <span title="Video track">
            <Film size={15} />
          </span>
          <span title="Audio track">
            <AudioLines size={15} />
          </span>
        </div>
        <div
          className="tracks"
          ref={track}
          onPointerDown={(e) => down(e, 'seek')}
          onPointerMove={(e) => move(e.clientX)}
          onPointerUp={finish}
          onPointerCancel={finish}
        >
          <div className="ruler">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i}>{clock((p.duration * i) / 6)}</span>
            ))}
          </div>
          <div className="filmstrip">
            {Array.from({ length: 15 }, (_, i) => (
              <div
                key={i}
                style={{ backgroundImage: `url("${frame(p, (p.duration * i) / 15)}")` }}
              />
            ))}
          </div>
          <div className="audio-track">
            {p.wave ? (
              <img src={asset(p, p.wave)} draggable={false} alt="Source audio waveform" />
            ) : (
              <span>Source timeline</span>
            )}
          </div>
          <div
            className="cut-selection"
            style={{
              left: `${(cut.start / p.duration) * 100}%`,
              width: `${((cut.end - cut.start) / p.duration) * 100}%`,
            }}
          >
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
          <i className="legend-square" /> Clip range
        </span>
        <span>
          <Scissors size={12} />
          {clock(cut.end - cut.start, true)} selected
        </span>
      </div>
    </section>
  );
}
