import { useState } from 'react';
import { ArrowLeft, Check, Plus } from 'lucide-react';
import { clock } from '../studio';
import type { Moment } from '../highlights';
import { ScoreParts, ScoreRing, openingLine } from './Score';

/**
 * The moments a search found, to pick from before they become clips (ClipCheap's project moments): each with its score,
 * the parts of it, how it opens and why; the review's picks ticked, the near-misses it turned down below them, unticked.
 * The whole card ticks it.
 */
export function Moments({
  moments,
  add,
  back,
}: {
  moments: readonly Moment[];
  add: (picked: Moment[]) => void;
  back: () => void;
}) {
  const [picked, setPicked] = useState(
    () => new Set(moments.flatMap((moment, index) => (moment.approved ? [index] : []))),
  );
  const toggle = (index: number) =>
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  const groups = [
    {
      title: 'Picked by the review',
      items: moments.map((m, i) => [m, i] as const).filter(([m]) => m.approved),
    },
    {
      title: 'Also considered',
      note: 'Whole moments the review scored lower. Tick any you want too.',
      items: moments.map((m, i) => [m, i] as const).filter(([m]) => !m.approved),
    },
  ].filter((group) => group.items.length);
  return (
    <div className="moments">
      <p className="moments-intro">
        {moments.length} {moments.length === 1 ? 'moment' : 'moments'} found. Scores are editorial
        estimates from what’s said, not predictions of views.
      </p>
      {groups.map((group) => (
        <section key={group.title} className="moments-group" aria-label={group.title}>
          <h3>
            {group.title}
            <small>{group.items.length}</small>
          </h3>
          {group.note && <p className="moments-note">{group.note}</p>}
          <ol>
            {group.items.map(([moment, index]) => {
              const on = picked.has(index);
              const length = Math.round(moment.end - moment.start);
              return (
                <li key={index}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={`moment${on ? ' on' : ''}`}
                    onClick={() => toggle(index)}
                  >
                    <span className="moment-head">
                      {moment.highlight.score !== undefined ? (
                        <ScoreRing score={moment.highlight.score} />
                      ) : (
                        <span className="score-ring empty" aria-hidden="true" />
                      )}
                      <span className="moment-title">
                        <strong>{moment.title}</strong>
                        <small>
                          {clock(moment.start)}–{clock(moment.end)} · {length} s
                        </small>
                      </span>
                      <span className="moment-tick" aria-hidden="true">
                        <Check size={13} strokeWidth={3} />
                      </span>
                    </span>
                    {moment.highlight.opening && (
                      <span className="score-opening">
                        Opens with “{openingLine(moment.highlight.opening)}”
                      </span>
                    )}
                    {moment.highlight.parts && <ScoreParts parts={moment.highlight.parts} />}
                    {moment.highlight.reason && (
                      <span className="score-why">
                        <b>Why: </b>
                        {moment.highlight.reason}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <div className="moments-actions">
        <button type="button" className="btn secondary" onClick={back}>
          <ArrowLeft size={14} aria-hidden="true" /> Search again
        </button>
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
  );
}
