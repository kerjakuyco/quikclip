import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  CAPTION_COLORS,
  CAPTION_POSITIONS,
  CAPTION_STYLES,
  captionMetrics,
  captionMoment,
  editCue,
  hasHighlight,
  isDark,
  paceCues,
  transcriptLines,
  wrapRanges,
  type CaptionPosition,
  type CaptionStyle,
  type Cue,
  type CutCaptions,
  type TimedText,
} from '../captions';
import { clock, type Cut } from '../studio';

/** Items laid out in lines as clip-ai wraps them, with a break between lines. */
function Lines<T extends { text: string }>({
  items,
  render,
}: {
  items: T[];
  render: (item: T, index: number) => ReactNode;
}) {
  const lines = wrapRanges(items.map((item) => item.text));
  return lines.map(([from, to], line) => (
    <Fragment key={line}>
      {line > 0 && <span aria-hidden="true" className="caption-break" />}
      {items.slice(from, to).map((item, offset) => (
        <Fragment key={from + offset}>
          {offset > 0 && ' '}
          {render(item, from + offset)}
        </Fragment>
      ))}
    </Fragment>
  ));
}

/**
 * One cue as it is drawn at `time` (the cue's own clock): Clean as it is, Bold with the word being said in the highlight,
 * Karaoke filling each word over its spoken time, Pop as short groups with a box on the word being said
 * (clip-clients caption-words.tsx).
 */
export function CaptionWords({
  cue,
  time,
  captionStyle,
  style,
}: {
  cue: Cue;
  time: number;
  captionStyle: CaptionStyle;
  style?: CSSProperties;
}) {
  if (captionStyle === 'none') return null;
  const moment = captionMoment(cue, time);
  if (captionStyle === 'pop') {
    return (
      <p key={moment.groupIndex} data-pop="" className="caption-pop" style={style}>
        <Lines
          items={moment.group}
          render={(word) => (
            <span data-active={word.index === moment.active ? '' : undefined}>{word.text}</span>
          )}
        />
      </p>
    );
  }
  return (
    <p className={`caption-line caption-${captionStyle}`} style={style}>
      <Lines
        items={moment.words}
        render={(word, index) => (
          <span
            data-active={captionStyle === 'bold' && index === moment.active ? '' : undefined}
            style={
              captionStyle === 'karaoke'
                ? ({ '--fill': `${Math.round(moment.fill[index] * 1000) / 10}%` } as CSSProperties)
                : undefined
            }
          >
            {word.text}
          </span>
        )}
      />
    </p>
  );
}

const PLACE = { bottom: 'flex-end', middle: 'center', top: 'flex-start' } as const;

/**
 * The captions over the preview, as the export burns them in: paced, sized and placed for the output frame (`width` ×
 * `height` pixels) in the stage's container units. `time` and the cues are on the clip's clock; `top` is where captions on
 * Top start, in pixels, under the headline.
 */
export function LiveCaptions({
  cues,
  time,
  captions,
  width,
  height,
  top,
  duration,
  lang,
}: {
  cues: Cue[];
  time: number;
  captions: CutCaptions;
  width: number;
  height: number;
  top: number;
  duration: number;
  /** The transcript's language, so CJK text takes its regional face as the export does. */
  lang?: string;
}) {
  const paced = useMemo(() => paceCues(cues, duration), [cues, duration]);
  const style = captions.style;
  const cue = paced.find((item) => time >= item.start && time < item.end);
  if (style === 'none' || !cue) return null;
  const metrics = captionMetrics(width, height, style);
  const colours = {
    '--caption-text': captions.color,
    '--caption-highlight': captions.highlight,
    '--caption-ink': isDark(captions.highlight) ? '#fff' : '#141414',
    '--caption-edge': isDark(captions.color) ? '#fff' : '#000',
    justifyContent: PLACE[captions.position],
  } as CSSProperties;
  const placed: CSSProperties = {
    fontSize: `${(metrics.size / width) * 100}cqw`,
    paddingInline: '6cqw',
    paddingTop: captions.position === 'top' ? `${(top / height) * 100}cqh` : 0,
    paddingBottom: captions.position === 'bottom' ? `${metrics.bottom * 100}cqh` : 0,
  };
  return (
    <div className="caption-stage" style={colours} lang={lang} aria-hidden="true">
      {/* A cue that follows an empty screen fades in, as the export fades it. */}
      <div key={cue.start} data-fade={cue.fade_in ? '' : undefined} className="caption-cue">
        <CaptionWords cue={cue} time={time} captionStyle={style} style={placed} />
      </div>
    </div>
  );
}

/** One caption line, edited in place; it keeps its time. */
function CueLine({
  cue,
  index,
  commit,
}: {
  cue: Cue;
  index: number;
  commit: (text: string) => void;
}) {
  const [text, setText] = useState(cue.text);
  useEffect(() => setText(cue.text), [cue.text]);
  return (
    <li>
      <label htmlFor={`cue-${index}`}>
        {clock(cue.start)}
        <span className="sr-only">, caption {index + 1}</span>
      </label>
      <textarea
        id={`cue-${index}`}
        rows={1}
        maxLength={200}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text.trim()) commit(text);
          else setText(cue.text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    </li>
  );
}

function Swatches({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const name = CAPTION_COLORS.find((color) => color.value === value)?.label;
  return (
    <>
      <span className="field-label swatch-label">
        {label} <small>{name}</small>
      </span>
      <div
        className="caption-swatches"
        role="radiogroup"
        aria-label={`Caption ${label.toLowerCase()}`}
      >
        {CAPTION_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            role="radio"
            aria-checked={value === color.value}
            aria-label={color.label}
            title={color.label}
            className={value === color.value ? 'active' : ''}
            style={{ background: color.value }}
            onClick={() => onChange(color.value)}
          />
        ))}
      </div>
    </>
  );
}

/** The Inspector's captions: every clip's come from the video's transcript. Choose a style, place and colours, and fix a
 *  line for this clip only; a misheard word is better fixed in the transcript, where every clip gets it. */
export function CaptionFields({
  cut,
  captions,
  cues,
  words,
  update,
  waiting,
  openTranscript,
}: {
  cut: Cut;
  captions: CutCaptions;
  cues: Cue[];
  /** The words the cues came from (the transcript's, with this clip's own lines). */
  words: TimedText[];
  update: (c: Partial<Cut>) => void;
  /** Why there are no captions yet: the transcript's progress or problem, or null once it is ready. */
  waiting: string | null;
  openTranscript: () => void;
}) {
  const set = (next: Partial<CutCaptions>) => update({ captions: { ...captions, ...next } });
  const own = captions.words !== undefined;
  return (
    <section className="caption-fields" aria-labelledby="captions-label">
      <span className="field-label" id="captions-label">
        Captions
      </span>
      <div className="format-options caption-styles" role="group" aria-label="Caption style">
        {CAPTION_STYLES.map((style) => (
          <button
            key={style.value}
            type="button"
            title={style.description}
            className={captions.style === style.value ? 'active' : ''}
            aria-pressed={captions.style === style.value}
            onClick={() => set({ style: style.value })}
          >
            {style.label}
          </button>
        ))}
      </div>
      {captions.style !== 'none' && (
        <>
          <span className="field-label">Position</span>
          <div className="format-options" role="group" aria-label="Caption position">
            {CAPTION_POSITIONS.map((position) => (
              <button
                key={position.value}
                type="button"
                className={captions.position === position.value ? 'active' : ''}
                aria-pressed={captions.position === position.value}
                onClick={() => set({ position: position.value as CaptionPosition })}
              >
                {position.label}
              </button>
            ))}
          </div>
          <Swatches label="Color" value={captions.color} onChange={(color) => set({ color })} />
          {hasHighlight(captions.style) && (
            <Swatches
              label="Highlight"
              value={captions.highlight}
              onChange={(highlight) => set({ highlight })}
            />
          )}
        </>
      )}
      {cues.length ? (
        <>
          <span className="field-label">Lines</span>
          <ol className="cue-list" aria-label="Caption lines">
            {cues.map((cue, index) => (
              <CueLine
                key={`${cut.id}-${index}-${cue.start}`}
                cue={cue}
                index={index}
                commit={(text) =>
                  update({ captions: editCue(captions, words, cue, text, cut.start, cut.end) })
                }
              />
            ))}
          </ol>
          <p className="fit-note">
            Exports save these captions as an .srt beside the clip.{' '}
            {own ? 'These lines were changed for this clip. ' : 'Misheard a word? '}
            <button type="button" className="link-btn" onClick={openTranscript}>
              {own ? 'Open the transcript' : 'Fix it in the transcript'}
            </button>
            {own ? ' to fix words for every clip.' : ', and every clip gets it.'}
          </p>
          {own && (
            <button
              type="button"
              className="text-btn caption-redo"
              onClick={() => update({ captions: transcriptLines(captions) })}
            >
              <RotateCcw size={12} /> Use the transcript’s lines
            </button>
          )}
        </>
      ) : waiting ? (
        <p className="fit-note" role="status">
          {waiting}
        </p>
      ) : (
        <p className="fit-note">No speech in this part of the video.</p>
      )}
    </section>
  );
}
