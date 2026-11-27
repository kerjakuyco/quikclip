import { useState, type MouseEvent } from 'react';
import { ArrowLeft, Check, ChevronDown, Play, Plus, Sparkles } from 'lucide-react';
import { clock } from '../studio';
import type { Moment } from '../highlights';
import { ScoreParts, ScoreRing, openingLine } from './Score';

/** How many moments show before "Show all". ClipCheap's picker starts with five. */
const SHOWN = 5;
const TOP = 3;

function lengthLabel(seconds: number) {
  const whole = Math.max(1, Math.round(seconds));
  return whole < 60 ? `${whole}s` : clock(seconds);
}

/** A click on the card ticks it. Watch, More and the player do their own thing. */
function picksFrom(event: MouseEvent<HTMLElement>) {
  return (
    !(event.target as HTMLElement).closest('button, video, [data-player]') &&
    !window.getSelection()?.toString()
  );
}

/**
 * The moments a search found, best first, to pick before they become clips (ClipCheap's project
 * moments card): a frame you can watch, the score ring and its four parts, how it opens, and why.
 * The review's picks start ticked. Near-misses stay in the same list, unticked.
 */
export function Moments({
  moments,
  video,
  poster,
  add,
  back,
}: {
  moments: readonly Moment[];
  /** Playable source. Absent hides Watch. */
  video?: string;
  poster?: (start: number, end: number) => string | undefined;
  add: (picked: Moment[]) => void;
  back: () => void;
}) {
  const [picked, setPicked] = useState(
    () => new Set(moments.flatMap((moment, index) => (moment.approved ? [index] : []))),
  );
  const [watching, setWatching] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [all, setAll] = useState(false);
  const toggle = (index: number) =>
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  const top = moments.slice(0, Math.min(TOP, moments.length)).map((_, index) => index);
  const onlyTop =
    top.length > 0 && top.every((index) => picked.has(index)) && picked.size === top.length;
  const shown = all ? moments : moments.slice(0, SHOWN);
  return (
    <div className="moments">
      <header className="moments-head">
        <p className="moments-count" aria-hidden="true">
          {String(moments.length).padStart(2, '0')}
        </p>
        <div>
          <p className="moments-kicker">Best first</p>
          <h3 className="moments-title">
            The AI found {moments.length} {moments.length === 1 ? 'moment' : 'moments'} worth a clip
          </h3>
          <p className="moments-intro">
            Scores are editorial estimates from what’s said, not predictions of views. Watch a
            still, then pick the ones to add.
          </p>
        </div>
      </header>
      <ol className="moments-list" aria-label="Moments, best first">
        {shown.map((moment, index) => {
          const on = picked.has(index);
          const length = moment.end - moment.start;
          const shot = poster?.(moment.start, moment.end);
          const watched = watching === index;
          const reason = moment.highlight.reason ?? '';
          const reasonOpen = open.has(index);
          const titleId = `moment-title-${index}`;
          return (
            <li
              key={`${moment.start}-${moment.end}-${moment.title}`}
              className={`moment${on ? ' on' : ''}`}
              style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
              onClick={(event) => {
                if (picksFrom(event)) toggle(index);
              }}
            >
              <span className="moment-index" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="moment-stage">
                {video ? (
                  <button
                    type="button"
                    className="moment-frame"
                    aria-pressed={watched}
                    aria-label={
                      watched ? `Stop watching “${moment.title}”` : `Watch “${moment.title}”`
                    }
                    onClick={() => setWatching(watched ? null : index)}
                  >
                    {shot ? <img src={shot} alt="" /> : <span className="moment-frame-empty" />}
                    <span className="moment-length" aria-hidden="true">
                      {lengthLabel(length)}
                    </span>
                    <span className="moment-play" aria-hidden="true">
                      <Play size={14} />
                    </span>
                    {moment.highlight.opening && (
                      <span className="moment-caption">
                        Opens with “{openingLine(moment.highlight.opening)}”
                      </span>
                    )}
                  </button>
                ) : shot ? (
                  <span className="moment-frame">
                    <img src={shot} alt="" />
                    <span className="moment-length" aria-hidden="true">
                      {lengthLabel(length)}
                    </span>
                    {moment.highlight.opening && (
                      <span className="moment-caption">
                        Opens with “{openingLine(moment.highlight.opening)}”
                      </span>
                    )}
                  </span>
                ) : (
                  moment.highlight.opening && (
                    <p className="score-opening">
                      Opens with “{openingLine(moment.highlight.opening)}”
                    </p>
                  )
                )}
                {moment.highlight.score !== undefined && (
                  <span className="moment-ring">
                    <ScoreRing score={moment.highlight.score} size={46} />
                  </span>
                )}
              </div>
              <div className="moment-body">
                <div className="moment-head">
                  <p id={titleId} className="moment-title">
                    {moment.title}
                  </p>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-labelledby={titleId}
                    className="moment-tick"
                    onClick={() => toggle(index)}
                  >
                    <Check size={13} strokeWidth={3} aria-hidden="true" />
                  </button>
                </div>
                <p className="moment-facts">
                  <span>
                    {clock(moment.start)}–{clock(moment.end)}
                  </span>
                  {moment.approved && <span className="moment-chip">Review pick</span>}
                </p>
                {moment.highlight.parts && (
                  <div className="moment-scores">
                    <ScoreParts parts={moment.highlight.parts} />
                  </div>
                )}
                {reason && (
                  <div className={`score-why${reasonOpen ? '' : ' clamp'}`}>
                    <p>
                      <b>Why: </b>
                      {reason}
                    </p>
                    {reason.length > 110 && (
                      <button
                        type="button"
                        className="moment-more"
                        aria-expanded={reasonOpen}
                        onClick={() =>
                          setOpen((now) => {
                            const next = new Set(now);
                            if (reasonOpen) next.delete(index);
                            else next.add(index);
                            return next;
                          })
                        }
                      >
                        {reasonOpen ? 'Less' : 'More'}
                      </button>
                    )}
                  </div>
                )}
              </div>
              {watched && video && (
                <div className="moment-player" data-player>
                  <video
                    src={video}
                    controls
                    autoPlay
                    playsInline
                    preload="auto"
                    aria-label={`Preview of “${moment.title}”`}
                    onLoadedMetadata={(event) => {
                      const el = event.currentTarget;
                      if (el.currentTime < moment.start - 0.25 || el.currentTime > moment.end)
                        el.currentTime = moment.start;
                    }}
                    onPlay={(event) => {
                      const el = event.currentTarget;
                      if (el.currentTime >= moment.end - 0.05) el.currentTime = moment.start;
                    }}
                    onTimeUpdate={(event) => {
                      if (event.currentTarget.currentTime >= moment.end)
                        event.currentTarget.pause();
                    }}
                  />
                  <div className="moment-player-bar">
                    <span>
                      {clock(moment.start)}–{clock(moment.end)}
                    </span>
                    <button type="button" onClick={() => setWatching(null)}>
                      Close preview
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {moments.length > SHOWN && (
        <button type="button" className="moments-more" onClick={() => setAll((value) => !value)}>
          {all ? 'Show fewer' : `Show all ${moments.length} moments`}
          <ChevronDown size={14} aria-hidden="true" data-open={all || undefined} />
        </button>
      )}
      <div className="moments-actions">
        <button type="button" className="btn secondary" onClick={back}>
          <ArrowLeft size={14} aria-hidden="true" /> Search again
        </button>
        <div className="moments-actions-end">
          {picked.size > 0 ? (
            <button type="button" className="btn secondary" onClick={() => setPicked(new Set())}>
              {onlyTop ? `Unpick top ${top.length}` : 'Clear picks'}
            </button>
          ) : (
            top.length > 0 && (
              <button
                type="button"
                className="btn secondary"
                onClick={() => setPicked(new Set(top))}
              >
                <Sparkles size={14} aria-hidden="true" /> Pick top {top.length}
              </button>
            )
          )}
          <button
            type="button"
            className="btn primary"
            disabled={!picked.size}
            onClick={() => add(moments.filter((_, index) => picked.has(index)))}
          >
            <Plus size={14} aria-hidden="true" />
            Add {picked.size} {picked.size === 1 ? 'clip' : 'clips'}
          </button>
        </div>
      </div>
    </div>
  );
}
