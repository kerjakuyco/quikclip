import { Plus, X } from 'lucide-react';
import { Select } from './Select';
import { LOGO_CORNERS } from '../logo';
import { BROLL_ICONS, CORNER_ICONS } from './icons';
import { MAX_BROLL, MIN_BROLL, newShot, type BRoll } from '../broll';
import { clock, parseTime, round, type Cut, type Video } from '../studio';
import { useEffect, useState } from 'react';

/** A time typed as seconds or 00:12.50, kept when it reads and is inside its bounds. */
export function SecondsField({
  label,
  value,
  min,
  max,
  commit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  commit: (n: number) => void;
}) {
  const shown = clock(value, true);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <label className="time-field">
      <span>{label}</span>
      <input
        aria-label={label}
        title="Seconds, or a time such as 00:12.50"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = parseTime(text);
          if (Number.isFinite(n) && n !== value) commit(round(Math.min(max, Math.max(min, n))));
          setText(shown);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}

/** The clip's b-roll shots, each from one of the project's videos, and adding one at the playhead. */
export function BrollFields({
  cut,
  shots,
  videos,
  own,
  playhead,
  update,
}: {
  cut: Cut;
  shots: readonly BRoll[];
  videos: readonly Video[];
  /** The clip's own video. */
  own: string;
  playhead: number;
  update: (c: Partial<Cut>) => void;
}) {
  const span = cut.end - cut.start;
  const change = (id: string, patch: Partial<BRoll>) =>
    update({ broll: shots.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)) });
  return (
    <div className="broll-fields">
      <p className="fit-note">
        {videos.length > 1
          ? 'Show other footage over part of the clip: a cutaway fills the frame, a corner shot sits over it. The clip’s sound keeps playing.'
          : 'Show another moment over part of the clip. Add a video to the project for other footage.'}
      </p>
      {shots.map((shot, index) => {
        const video = videos.find((item) => item.id === shot.video) ?? videos[0];
        return (
          <div key={shot.id} className="broll-shot" role="group" aria-label={`B-roll ${index + 1}`}>
            <div className="broll-head">
              <Select
                className="select-field"
                label={`B-roll ${index + 1} video`}
                value={shot.video}
                onChange={(next) => change(shot.id, { video: next, from: 0 })}
                options={videos.map((item, at) => ({
                  value: item.id,
                  label: `V${at + 1} · ${item.title}${item.id === own ? ' (this clip’s)' : ''}`,
                }))}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove b-roll ${index + 1}`}
                onClick={() => update({ broll: shots.filter((item) => item.id !== shot.id) })}
              >
                <X size={14} />
              </button>
            </div>
            <div className="broll-times">
              <SecondsField
                label="Shows at"
                value={shot.at}
                min={0}
                max={Math.max(0, span - MIN_BROLL)}
                commit={(at) => change(shot.id, { at, length: Math.min(shot.length, span - at) })}
              />
              <SecondsField
                label="For"
                value={shot.length}
                min={MIN_BROLL}
                max={Math.max(MIN_BROLL, Math.min(span - shot.at, video.duration))}
                commit={(length) => change(shot.id, { length })}
              />
              <SecondsField
                label="From"
                value={shot.from}
                min={0}
                max={Math.max(0, video.duration - shot.length)}
                commit={(from) => change(shot.id, { from })}
              />
            </div>
            <div
              className="format-options broll-modes"
              role="group"
              aria-label={`B-roll ${index + 1} layout`}
            >
              {(
                [
                  ['cutaway', 'Fill the frame'],
                  ['pip', 'In a corner'],
                ] as const
              ).map(([mode, label]) => {
                const Icon = BROLL_ICONS[mode];
                return (
                  <button
                    key={mode}
                    type="button"
                    className={shot.mode === mode ? 'active' : ''}
                    aria-pressed={shot.mode === mode}
                    onClick={() => change(shot.id, { mode })}
                  >
                    <Icon size={14} aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>
            {shot.mode === 'pip' && (
              <div
                className="format-options broll-corners"
                role="group"
                aria-label={`B-roll ${index + 1} corner`}
              >
                {LOGO_CORNERS.map((corner) => {
                  const Icon = CORNER_ICONS[corner.value];
                  return (
                    <button
                      key={corner.value}
                      type="button"
                      className={(shot.corner ?? 'top-right') === corner.value ? 'active' : ''}
                      aria-pressed={(shot.corner ?? 'top-right') === corner.value}
                      onClick={() => change(shot.id, { corner: corner.value })}
                    >
                      <Icon size={14} aria-hidden="true" />
                      {corner.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="btn secondary asset-button"
        disabled={shots.length >= MAX_BROLL || span < MIN_BROLL * 2}
        onClick={() => update({ broll: [...shots, newShot(cut, own, videos, playhead)] })}
      >
        <Plus size={13} /> Add b-roll at the playhead
      </button>
    </div>
  );
}
