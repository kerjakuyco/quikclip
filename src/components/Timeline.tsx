import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import {
  AudioLines,
  Expand,
  Film,
  ListVideo,
  Magnet,
  Plus,
  Scan,
  Scissors,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Select } from './Select';
import { asset, clamp, clock, desktop, frame, type Cut, type Project } from '../studio';
import {
  boundView,
  fitClip,
  minViewSpan,
  rulerTicks,
  zoomView,
  type TimelineView,
  type TrimMotion,
  type TrimSnap,
} from '../timeline';

type Edge = 'start' | 'end';
type Drag = {
  pointer: number;
  mode: Edge | 'seek';
  origin: number;
  secondsPerPixel: number;
  offset: number;
};

export function Timeline({
  p,
  cut,
  time,
  seek,
  trim,
  add,
  snap,
  canSnapWords,
  setSnap,
}: {
  p: Project;
  cut: Cut;
  time: number;
  seek: (n: number) => void;
  trim: (which: Edge, n: number, motion: TrimMotion) => number;
  add: () => void;
  snap: TrimSnap;
  canSnapWords: boolean;
  setSnap: (snap: TrimSnap) => void;
}) {
  const { duration } = p;
  const [view, setView] = useState<TimelineView>({ start: 0, span: duration });
  const [width, setWidth] = useState(0);
  const [trimming, setTrimming] = useState<Edge | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const previousCut = useRef(cut.id);
  const canSnapFrames = Number.isFinite(p.fps) && p.fps > 0;
  const snapActive = snap === 'frames' ? canSnapFrames : snap === 'words' && canSnapWords;

  useEffect(() => {
    const el = track.current!;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (previousCut.current === cut.id) return;
    previousCut.current = cut.id;
    // Keep the zoom when moving between cuts, but don't leave a newly selected cut out of sight.
    setView((old) =>
      cut.start < old.start || cut.start >= old.start + old.span
        ? boundView(cut.start - old.span * 0.15, old.span, duration)
        : old,
    );
  }, [cut.id, cut.start, duration]);
  useEffect(() => {
    const el = track.current!;
    const wheel = (event: WheelEvent) => {
      const zooming = event.ctrlKey || event.metaKey;
      const delta = zooming
        ? event.deltaY || event.deltaX
        : event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!delta) return; // Ordinary vertical scrolling still belongs to the workspace.
      event.preventDefault();
      if (drag.current) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.width : 1);
      const at = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      setView((old) =>
        zooming
          ? zoomView(
              old,
              duration,
              Math.exp(clamp(pixels, -400, 400) / 240),
              old.start + at * old.span,
            )
          : boundView(old.start + (pixels / rect.width) * old.span, old.span, duration),
      );
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [duration]);

  const viewEnd = view.start + view.span;
  const panMax = duration - view.span;
  const atPercent = (n: number) => clamp(((n - view.start) / view.span) * 100, 0, 100);
  const visible = (n: number) => n >= view.start - 1e-8 && n <= viewEnd + 1e-8;
  const ticks = useMemo(() => rulerTicks(view, width), [view, width]);
  const tiles = clamp(Math.ceil(width / 76), 4, 18);
  const clipIndex = p.cuts.findIndex((item) => item.id === cut.id) + 1;
  const selectionLeft = atPercent(cut.start);
  const selection = atPercent(cut.end) - selectionLeft;
  const rangeText = `${clock(view.start, true)} to ${clock(viewEnd, true)}`;
  const pan = (start: number) => setView((old) => boundView(start, old.span, duration));
  const zoom = (factor: number) =>
    setView((old) =>
      zoomView(
        old,
        duration,
        factor,
        time >= old.start && time <= old.start + old.span ? time : old.start + old.span / 2,
      ),
    );

  function move(e: PointerEvent<HTMLElement>) {
    const active = drag.current;
    if (!active || active.pointer !== e.pointerId) return;
    const n = clamp(
      view.start + (e.clientX - active.origin) * active.secondsPerPixel + active.offset,
      view.start,
      viewEnd,
    );
    if (active.mode === 'seek') seek(n);
    else trim(active.mode, n, { free: e.altKey });
  }
  function down(e: PointerEvent<HTMLElement>, mode: Drag['mode']) {
    if (!e.isPrimary || e.button !== 0 || drag.current) return;
    const rect = track.current!.getBoundingClientRect();
    if (!rect.width) return;
    e.stopPropagation();
    const secondsPerPixel = view.span / rect.width;
    const grabbedAt = view.start + (e.clientX - rect.left) * secondsPerPixel;
    drag.current = {
      pointer: e.pointerId,
      mode,
      origin: rect.left,
      secondsPerPixel,
      offset: mode === 'seek' ? 0 : cut[mode] - grabbedAt,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (mode === 'seek') move(e);
    else setTrimming(mode);
  }
  function finish(e: PointerEvent<HTMLElement>) {
    if (drag.current?.pointer !== e.pointerId) return;
    drag.current = null;
    setTrimming(null);
  }
  return (
    <section className="timeline" aria-labelledby="timeline-title">
      <div className="panel-heading">
        <h2 id="timeline-title">
          <ListVideo />
          Timeline
        </h2>
        <div className="timeline-tools">
          <div className="timeline-view-tools" role="group" aria-label="Timeline view">
            <button
              type="button"
              className="icon-btn"
              aria-label="Zoom timeline out"
              title="Zoom out (Ctrl + scroll)"
              disabled={panMax === 0}
              onClick={() => zoom(2)}
            >
              <ZoomOut size={15} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Zoom timeline in"
              title="Zoom in (Ctrl + scroll)"
              disabled={view.span <= minViewSpan(duration)}
              onClick={() => zoom(0.5)}
            >
              <ZoomIn size={15} />
            </button>
            <button
              type="button"
              className="icon-btn timeline-tool-label"
              aria-label="Fit clip"
              title="Fit selected clip"
              onClick={() => setView(fitClip(cut.start, cut.end, duration))}
            >
              <Scan size={15} /> <span>Fit clip</span>
            </button>
            <button
              type="button"
              className="icon-btn timeline-tool-label"
              aria-label="Show full source"
              title="Show full source"
              disabled={panMax === 0}
              onClick={() => setView({ start: 0, span: duration })}
            >
              <Expand size={15} /> <span>Full source</span>
            </button>
            <Select
              className={`timeline-snap${snapActive ? ' active' : ''}`}
              label="Trim snapping"
              description="Words require a transcript. Frames require a known frame rate."
              title="Trim snapping. Hold Alt (Option on Mac) while dragging to trim freely."
              icon={<Magnet size={15} aria-hidden="true" />}
              value={snap}
              onChange={(next) => setSnap(next as TrimSnap)}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'frames', label: 'Frames', disabled: !canSnapFrames },
                { value: 'words', label: 'Words', disabled: !canSnapWords },
              ]}
            />
          </div>
          <button
            type="button"
            className="btn secondary timeline-add"
            aria-label="Add clip"
            title="Add clip at the playhead"
            onClick={add}
          >
            <Plus size={14} /> <span>Add clip</span>
          </button>
        </div>
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
        <div className="track-view">
          <div
            className="tracks"
            ref={track}
            onPointerDown={(e) => down(e, 'seek')}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={finish}
            onLostPointerCapture={finish}
          >
            <div className="ruler" aria-hidden="true">
              {ticks.map(({ at, label }) => {
                const left = atPercent(at);
                const px = (left / 100) * width;
                return (
                  <span
                    key={at}
                    className="ruler-mark"
                    data-align={px < 27 ? 'start' : width - px < 27 ? 'end' : undefined}
                    style={{ left: `${left}%` }}
                  >
                    <span>{label}</span>
                  </span>
                );
              })}
            </div>
            <div className="filmstrip" aria-hidden="true">
              {Array.from({ length: tiles }, (_, i) => {
                const thumbnail = frame(p, view.start + (view.span * (i + 0.5)) / tiles);
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
                <svg
                  role="img"
                  aria-label="Source audio waveform"
                  viewBox={`${(view.start / duration) * 1000} 0 ${(view.span / duration) * 1000} 64`}
                  preserveAspectRatio="none"
                >
                  <image
                    href={asset(p, p.wave)}
                    width="1000"
                    height="64"
                    preserveAspectRatio="none"
                  />
                </svg>
              ) : desktop && p.id !== 'sample' && p.wave === undefined ? (
                <span role="status">Drawing the audio waveform…</span>
              ) : (
                <span>Waveform unavailable</span>
              )}
            </div>
            {selection > 0 && (
              <div
                className="cut-selection"
                style={{ left: `${selectionLeft}%`, width: `${selection}%` }}
              >
                {(selection / 100) * width >= 95 && (
                  <span className="selection-label" aria-hidden="true">
                    <b>{String(clipIndex).padStart(2, '0')}</b>
                    <span>{cut.title}</span>
                  </span>
                )}
              </div>
            )}
            {(['start', 'end'] as const).map(
              (k) =>
                (visible(cut[k]) || trimming === k) && (
                  <button
                    key={k}
                    type="button"
                    aria-label={`Drag clip ${k}`}
                    title={`Adjust ${k} (arrow keys)`}
                    className={`handle ${k}`}
                    style={{ '--handle-at': `${atPercent(cut[k])}%` } as CSSProperties}
                    onPointerDown={(e) => down(e, k)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        e.stopPropagation();
                        const at = trim(k, cut[k], {
                          step: e.key === 'ArrowLeft' ? -1 : 1,
                          free: e.altKey,
                        });
                        if (!visible(at)) pan(at - view.span * (at < view.start ? 0.15 : 0.85));
                      }
                    }}
                  >
                    <i />
                  </button>
                ),
            )}
            {visible(time) && (
              <div
                className="playhead"
                style={{ left: `min(${atPercent(time)}%, calc(100% - 1px))` }}
                aria-hidden="true"
              >
                <i />
              </div>
            )}
          </div>
          <div className="timeline-navigator">
            <i
              className="overview-cut"
              aria-hidden="true"
              style={{
                left: `${(cut.start / duration) * 100}%`,
                width: `${((cut.end - cut.start) / duration) * 100}%`,
              }}
            />
            <input
              type="range"
              aria-label="Pan timeline"
              aria-valuetext={rangeText}
              title="Pan timeline (Shift + scroll)"
              min={0}
              max={panMax}
              step="any"
              value={view.start}
              disabled={!panMax}
              style={{ '--window-width': `${(view.span / duration) * width}px` } as CSSProperties}
              onChange={(e) => pan(Number(e.target.value))}
              onKeyDown={(e) => {
                const positions: Record<string, number> = {
                  ArrowLeft: view.start - view.span / 4,
                  ArrowDown: view.start - view.span / 4,
                  ArrowRight: view.start + view.span / 4,
                  ArrowUp: view.start + view.span / 4,
                  PageDown: view.start - view.span,
                  PageUp: view.start + view.span,
                  Home: 0,
                  End: panMax,
                };
                const next = positions[e.key];
                if (typeof next !== 'number') return;
                e.preventDefault();
                pan(next);
              }}
            />
          </div>
        </div>
      </div>
      <div className="timeline-foot">
        <span className="timeline-legend">
          <i className="legend-square" aria-hidden="true" /> Selected range
        </span>
        <span className="timeline-range" title="Visible source range">
          {clock(view.start, true)} – {clock(viewEnd, true)}
        </span>
        <span className="timeline-duration">
          <Scissors size={12} />
          <b>{clock(cut.end - cut.start, true)}</b>
          <span>selected</span>
        </span>
      </div>
    </section>
  );
}
