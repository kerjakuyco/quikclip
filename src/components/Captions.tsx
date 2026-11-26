import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Languages, LoaderCircle, RotateCcw } from 'lucide-react';
import {
  CAPTION_COLORS,
  CAPTION_POSITIONS,
  CAPTION_STYLES,
  TRANSLATE_LANGUAGES,
  captionMetrics,
  captionMoment,
  clearTranslation,
  editCue,
  hasHighlight,
  isDark,
  languageName,
  paceCues,
  transcriptLines,
  translationAt,
  wrapRanges,
  writeTranslationLine,
  type CaptionPosition,
  type CaptionStyle,
  type Cue,
  type CutCaptions,
  type TimedText,
} from '../captions';
import { clock, desktop, type Cut } from '../studio';

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

/** A readable sample of one caption style. Quikclip Captions is Noto Sans (SIL OFL), the face the export burns in. */
function StyleSample({ style }: { style: CaptionStyle }) {
  if (style === 'none') return <span className="style-sample style-sample-none">Off</span>;
  if (style === 'pop')
    return (
      <span className="style-sample style-sample-pop">
        <i>It</i> pops
      </span>
    );
  if (style === 'karaoke')
    return (
      <span className="style-sample style-sample-karaoke">
        <i>Ma</i>ke
      </span>
    );
  if (style === 'clean') return <span className="style-sample style-sample-clean">Clean</span>;
  return (
    <span className="style-sample style-sample-bold">
      Make <i>it</i>
    </span>
  );
}

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
      <div
        key={cue.start}
        data-fade={cue.fade_in ? '' : undefined}
        className="caption-cue"
        style={placed}
      >
        <CaptionWords cue={cue} time={time} captionStyle={style} />
        {cue.translation && <p className="caption-translation">{cue.translation}</p>}
      </div>
    </div>
  );
}

/** One caption line, edited in place; it keeps its time. */
function CueLine({
  cue,
  index,
  translation,
  commit,
  commitTranslation,
}: {
  cue: Cue;
  index: number;
  /** The second language under this line, or undefined when it isn't shown. */
  translation?: string;
  commit: (text: string) => void;
  commitTranslation?: (text: string) => void;
}) {
  const [text, setText] = useState(cue.text);
  const [other, setOther] = useState(translation ?? '');
  useEffect(() => setText(cue.text), [cue.text]);
  useEffect(() => setOther(translation ?? ''), [translation]);
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
      {translation !== undefined && (
        <textarea
          className="cue-translation"
          aria-label={`Translation ${index + 1}`}
          rows={1}
          maxLength={300}
          placeholder="Not translated yet"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onBlur={() => commitTranslation?.(other)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      )}
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
  const selected = CAPTION_COLORS.findIndex((color) => color.value === value);
  const name = CAPTION_COLORS[selected]?.label;
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
        {CAPTION_COLORS.map((color, index) => (
          <button
            key={color.value}
            type="button"
            role="radio"
            aria-checked={index === selected}
            aria-label={color.label}
            title={color.label}
            tabIndex={index === Math.max(0, selected) ? 0 : -1}
            onClick={() => onChange(color.value)}
            onKeyDown={(event) => {
              const size = CAPTION_COLORS.length;
              let next: number;
              switch (event.key) {
                case 'ArrowLeft':
                case 'ArrowUp':
                  next = (index - 1 + size) % size;
                  break;
                case 'ArrowRight':
                case 'ArrowDown':
                  next = (index + 1) % size;
                  break;
                case 'Home':
                  next = 0;
                  break;
                case 'End':
                  next = size - 1;
                  break;
                default:
                  return;
              }
              event.preventDefault();
              event.stopPropagation();
              onChange(CAPTION_COLORS[next].value);
              event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
            }}
          >
            <span
              className="swatch-sample"
              aria-hidden="true"
              style={{
                backgroundColor: color.value,
                color: isDark(color.value) ? '#f3f4f6' : '#191e25',
              }}
            >
              {index === selected && <Check size={13} />}
            </span>
          </button>
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
  spoken,
  translating,
  onTranslate,
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
  /** The language Whisper heard, so the translate menu doesn't start on that same language. */
  spoken?: string | null;
  translating: boolean;
  onTranslate: (language: string, both: boolean) => void;
}) {
  const set = (next: Partial<CutCaptions>) => update({ captions: { ...captions, ...next } });
  const own = captions.words !== undefined;
  const translated = captions.translation;
  const [choice, setChoice] = useState<string>(
    translated?.language ?? (spoken === 'es' ? 'en' : 'es'),
  );
  const [showBoth, setShowBoth] = useState(translated?.both ?? false);
  useEffect(() => {
    if (!translated) return;
    setChoice(translated.language);
    setShowBoth(translated.both);
  }, [translated?.language, translated?.both]);
  const both = translated ? translated.both : showBoth;
  const missing = translated
    ? cues.filter((cue) => !translationAt(translated.lines, cut.start + cue.start)).length
    : 0;
  const note = !cues.length
    ? 'Translation is available once this clip has captions.'
    : !translated
      ? 'Uses your Highlight finder model and keeps the line timings.'
      : missing
        ? `${missing} ${missing === 1 ? 'line isn’t' : 'lines aren’t'} translated yet. Translate again to include ${missing === 1 ? 'it' : 'them'}.`
        : both
          ? 'The translation appears below the original line.'
          : `Translated to ${languageName(translated.language)}. Word timings are estimated.`;
  return (
    <section className="caption-fields" aria-labelledby="captions-label">
      <span className="field-label" id="captions-label">
        Style
      </span>
      <div className="caption-styles" role="group" aria-label="Caption style">
        {CAPTION_STYLES.map((style) => (
          <button
            key={style.value}
            type="button"
            title={style.description}
            className={captions.style === style.value ? 'active' : ''}
            aria-pressed={captions.style === style.value}
            aria-label={style.label}
            onClick={() => set({ style: style.value })}
          >
            <span className="style-name">{style.label}</span>
            <StyleSample style={style.value} />
          </button>
        ))}
      </div>
      {captions.style !== 'none' && (
        <>
          <span className="field-label">Position</span>
          <div className="caption-position" role="group" aria-label="Caption position">
            {CAPTION_POSITIONS.map((position) => (
              <button
                key={position.value}
                type="button"
                className={captions.position === position.value ? 'active' : ''}
                aria-pressed={captions.position === position.value}
                onClick={() => set({ position: position.value as CaptionPosition })}
              >
                <span
                  className="position-preview"
                  data-position={position.value}
                  aria-hidden="true"
                />
                {position.label}
              </button>
            ))}
          </div>
          <Swatches
            label="Text color"
            value={captions.color}
            onChange={(color) => set({ color })}
          />
          {hasHighlight(captions.style) && (
            <Swatches
              label="Highlight color"
              value={captions.highlight}
              onChange={(highlight) => set({ highlight })}
            />
          )}
          <section className="translate-card" aria-labelledby="caption-translate">
            <div className="translate-head">
              <span className="field-label" id="caption-translate">
                Translate captions
              </span>
              {translated && (
                <span className="translate-chip">In {languageName(translated.language)}</span>
              )}
            </div>
            <div className="translate-row">
              <select
                aria-label="Translate into"
                value={choice}
                disabled={translating}
                onChange={(e) => setChoice(e.target.value)}
              >
                {TRANSLATE_LANGUAGES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="translate-go"
                disabled={translating || !cues.length}
                onClick={() => onTranslate(choice, both)}
              >
                {translating ? (
                  <LoaderCircle size={13} className="spin" />
                ) : (
                  <Languages size={13} />
                )}
                {translating ? 'Translating…' : translated ? 'Translate again' : 'Translate'}
              </button>
            </div>
            <label className="both-languages">
              <span>Show both languages</span>
              <input
                type="checkbox"
                role="switch"
                aria-label="Show both languages"
                checked={both}
                disabled={translating}
                onChange={(e) => {
                  const next = e.target.checked;
                  setShowBoth(next);
                  if (translated) set({ translation: { ...translated, both: next } });
                }}
              />
            </label>
            <p className="fit-note" aria-live="polite">
              {note}
            </p>
            {translated && (
              <button
                type="button"
                className="text-btn caption-redo"
                onClick={() => update({ captions: clearTranslation(captions) })}
              >
                <RotateCcw size={12} /> Remove translation
              </button>
            )}
          </section>
        </>
      )}
      {cues.length ? (
        <>
          <span className="field-label">Caption lines</span>
          <ol className="cue-list" aria-label="Caption lines">
            {cues.map((cue, index) => {
              const at = cut.start + cue.start;
              const replacing = Boolean(translated && !translated.both);
              return (
                <CueLine
                  key={`${cut.id}-${index}-${cue.start}`}
                  cue={cue}
                  index={index}
                  translation={both && translated ? (cue.translation ?? '') : undefined}
                  commit={(text) =>
                    update({
                      captions: replacing
                        ? writeTranslationLine(captions, at, text)
                        : editCue(captions, words, cue, text, cut.start, cut.end),
                    })
                  }
                  commitTranslation={(text) =>
                    update({ captions: writeTranslationLine(captions, at, text) })
                  }
                />
              );
            })}
          </ol>
          <p className="fit-note">
            {desktop && captions.style !== 'none' && 'Export also saves an .srt file. '}
            {own && 'These edits apply only to this clip. '}
            <button type="button" className="link-btn" onClick={openTranscript}>
              Open the transcript
            </button>{' '}
            to correct words across all clips.
          </p>
          {own && (
            <button
              type="button"
              className="text-btn caption-redo"
              onClick={() => update({ captions: transcriptLines(captions) })}
            >
              <RotateCcw size={12} /> Reset to transcript
            </button>
          )}
        </>
      ) : waiting ? (
        <p className="fit-note" role="status">
          {waiting}
        </p>
      ) : (
        <p className="fit-note">No speech in this clip.</p>
      )}
    </section>
  );
}
