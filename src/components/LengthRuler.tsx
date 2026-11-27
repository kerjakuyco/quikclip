import type { CSSProperties } from 'react';
import {
  CLIP_LENGTHS,
  clipLengthBand,
  clipSeconds,
  lengthSpot,
  rulerSpot,
  type ClipLength,
} from '../clips';
import type { Cut } from '../studio';

/** What each band reads on the ruler; the full names in clips.ts are what assistive tech hears. */
const MARKS: Record<ClipLength, string> = {
  any: 'All',
  short: '0–30s',
  medium: '30–60s',
  long: '60s+',
};
/** More ticks than this in a band would only blur together. */
const MAX_TICKS = 80;

/**
 * The clip bin's length filter, drawn as a ruler cut into bands. Each band counts the clips in it and puts a tick at
 * each clip's length, so the spread is visible before choosing; the selected clip's tick stands taller. Choosing the
 * band that is on turns it off again.
 */
export function LengthRuler({
  cuts,
  current,
  value,
  onChange,
}: {
  /** The clips the search leaves, so the counts answer “how many of these”. */
  cuts: readonly Pick<Cut, 'id' | 'start' | 'end'>[];
  /** The selected clip's id. */
  current: string;
  value: ClipLength;
  onChange: (value: ClipLength) => void;
}) {
  const lengths = cuts.map((cut) => ({ id: cut.id, seconds: clipSeconds(cut) }));
  const longest = Math.max(0, ...lengths.map((item) => item.seconds));
  return (
    <div className="length-filter">
      <div className="length-ruler" role="group" aria-label="Clip length">
        {CLIP_LENGTHS.map(([band, name]) => {
          const inside =
            band === 'any'
              ? lengths
              : lengths.filter((item) => clipLengthBand(item.seconds) === band);
          const on = value === band;
          const count = inside.length;
          return (
            <button
              key={band}
              type="button"
              className={on ? 'active' : undefined}
              aria-pressed={on}
              aria-label={`${name}, ${count} ${count === 1 ? 'clip' : 'clips'}`}
              data-empty={count === 0 || undefined}
              onClick={() => onChange(on && band !== 'any' ? 'any' : band)}
            >
              <span className="length-name" aria-hidden="true">
                <span>{MARKS[band]}</span>
                <span className="length-count">{count}</span>
              </span>
              <span className={`length-track${band === 'any' ? ' whole' : ''}`} aria-hidden="true">
                {inside.slice(0, MAX_TICKS).map((item) => (
                  <i
                    key={item.id}
                    className={item.id === current ? 'current' : undefined}
                    style={
                      {
                        '--at':
                          band === 'any'
                            ? rulerSpot(item.seconds, longest)
                            : lengthSpot(item.seconds, longest),
                      } as CSSProperties
                    }
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
