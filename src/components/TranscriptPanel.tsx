import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, Download, Pencil, Scissors, Search, Sparkles } from 'lucide-react';
import type { SuggestedCut } from '../suggest';
import { cutSeconds, cutWords, toggleWords } from '../textcut';
import { TranscriberFields } from './TranscriberFields';
import type { LocalTranscriber } from '../transcriber';
import { Select } from './Select';
import {
  TRANSLATE_LANGUAGES,
  readingLines,
  type IndexedWord,
  type Transcript,
  type TranscriptFixes,
  type TranscriptLine,
} from '../captions';
import { clock } from '../studio';

/** Whisper's language for this video, or Detect. */
function SpokenLanguage({
  value,
  onChange,
  again,
}: {
  value: string;
  onChange: (code: string) => void;
  again?: () => void;
}) {
  return (
    <div className="spoken-row">
      <div className="spoken-field">
        <span aria-hidden="true">Spoken language</span>
        <Select
          className="select-field"
          label="Spoken language"
          value={value}
          onChange={onChange}
          options={[
            { value: 'auto', label: 'Detect' },
            ...TRANSLATE_LANGUAGES.map((item) => ({ value: item.code, label: item.name })),
          ]}
        />
      </div>
      {again && (
        <button type="button" className="text-btn" onClick={again}>
          Transcribe again
        </button>
      )}
    </div>
  );
}

/** How a project's transcript is coming along when it isn't ready. */
export type TranscriptStatus =
  | { state: 'working'; done: number; total: number }
  | { state: 'error'; text: string }
  | { state: 'connect' }
  | { state: 'unavailable'; text: string };

type LineActions = {
  pick: (word: IndexedWord, extend: boolean) => void;
  /** Cutting words: pressing on one, passing over others, and letting go. */
  press: (word: IndexedWord) => void;
  pass: (word: IndexedWord) => void;
  open: (index: number) => void;
  fix: (index: number, text: string) => void;
  close: () => void;
};

/** One line: drawn again only when it becomes or stops being the spoken one, or its words change (clip-clients). */
const Line = memo(function Line({
  line,
  number,
  current,
  spoken,
  inClip,
  editing,
  open,
  act,
  cutting,
  cutKey,
  pendingKey,
  suggestKey,
}: {
  line: TranscriptLine;
  number: number;
  current: boolean;
  spoken: number;
  inClip: boolean;
  editing: boolean;
  open: number | null;
  act: LineActions;
  /** Cutting words, with the line's cut words and the ones being dragged over, as comma lists (for memo). */
  cutting: boolean;
  cutKey: string;
  pendingKey: string;
  /** The line's words in a cut the AI suggested, as a comma list. */
  suggestKey: string;
}) {
  const cut = new Set(cutKey ? cutKey.split(',').map(Number) : []);
  const pending = new Set(pendingKey ? pendingKey.split(',').map(Number) : []);
  const suggestedWords = new Set(suggestKey ? suggestKey.split(',').map(Number) : []);
  return (
    <li
      data-line={number}
      className={`transcript-line${current ? ' now' : ''}${inClip ? ' in-clip' : ''}`}
    >
      <time>{clock(line.start)}</time>
      <p>
        {line.words.map((word, offset) => (
          <span key={word.index}>
            {offset > 0 && ' '}
            {open === word.index ? (
              <input
                className="word-fix"
                aria-label={`Correct “${word.text}”`}
                autoFocus
                defaultValue={word.text}
                size={Math.max(3, word.text.length + 1)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') act.fix(word.index, e.currentTarget.value);
                  if (e.key === 'Escape') act.close();
                }}
                onBlur={(e) => act.fix(word.index, e.currentTarget.value)}
              />
            ) : (
              <span
                className={`word${word.index === spoken ? ' spoken' : ''}${cut.has(word.index) ? ' cut' : ''}${pending.has(word.index) ? ' pending' : ''}${suggestedWords.has(word.index) ? ' suggested' : ''}`}
                role="button"
                tabIndex={-1}
                data-start={word.start}
                aria-label={
                  cut.has(word.index)
                    ? `${word.text} (cut from the clip)`
                    : suggestedWords.has(word.index)
                      ? `${word.text} (suggested cut)`
                      : undefined
                }
                onPointerDown={(e) => {
                  if (cutting && e.button === 0) {
                    e.preventDefault();
                    act.press(word);
                  }
                }}
                onPointerEnter={() => cutting && act.pass(word)}
                onClick={(e) => {
                  if (cutting) return;
                  if (editing) act.open(word.index);
                  else act.pick(word, e.shiftKey);
                }}
                onDoubleClick={() => !cutting && act.open(word.index)}
              >
                {word.text}
              </span>
            )}
          </span>
        ))}
      </p>
    </li>
  );
});

/**
 * The video's transcript, as ClipCheap's Transcript tab (clip-clients moments-panel TranscriptLines): read and search what
 * was said, follow it as it plays, click a word to go there or Shift+click to set the clip's in and out points, and correct
 * a misheard word, which every clip's captions then use.
 */
export function TranscriptPanel({
  transcript,
  fixes,
  status,
  time,
  clip,
  onSeek,
  onRange,
  onFix,
  language,
  onLanguage,
  onTranscribe,
  onConnect,
  onDownload,
  transcriber,
  setTranscriber,
  removed,
  onRemoved,
  tighten,
  suggested = [],
  onTake,
  onDismiss,
}: {
  transcript: Transcript | undefined;
  fixes: TranscriptFixes | undefined;
  status: TranscriptStatus | null;
  /** The playhead on the source clock. */
  time: number;
  /** The selected clip's range, whose lines are marked. */
  clip: { start: number; end: number };
  onSeek: (time: number) => void;
  onRange: (start: number, end: number) => void;
  onFix: (index: number, text: string) => void;
  /** Whisper's language for the next run: `auto` detects it. */
  language: string;
  onLanguage: (code: string) => void;
  /** `again` throws away a finished transcript and makes it once more. */
  onTranscribe: (again: boolean) => void;
  onConnect: () => void;
  /** Saves the transcript as text, or the whole video's subtitles. */
  onDownload: (kind: 'txt' | 'srt') => void;
  /** A Whisper server on this computer, when one is used instead of the cloud. */
  transcriber: LocalTranscriber | null;
  setTranscriber: (transcriber: LocalTranscriber | null) => void;
  /** The clip's words cut in the transcript, and changing them. */
  removed: [number, number][];
  onRemoved: (removed: [number, number][]) => void;
  /** The AI's "Tighten" button, and the cuts it suggested, to take one by one or all at once. */
  tighten?: ReactNode;
  suggested?: SuggestedCut[];
  onTake?: (cuts: SuggestedCut[]) => void;
  onDismiss?: () => void;
}) {
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim().toLowerCase());
  const [editing, setEditing] = useState(false);
  // Cutting words from the clip: a run is chosen by pressing on a word and letting go on another.
  const [cutting, setCutting] = useState(false);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const anchor = useRef<IndexedWord | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const lines = useMemo(
    () => (transcript ? readingLines(transcript, fixes) : []),
    [transcript, fixes],
  );
  const shown = useMemo(
    () =>
      search
        ? lines
            .map((line, number) => ({ line, number }))
            .filter(({ line }) =>
              line.words
                .map((w) => w.text)
                .join(' ')
                .toLowerCase()
                .includes(search),
            )
        : lines.map((line, number) => ({ line, number })),
    [lines, search],
  );
  // The line being spoken, found by binary search (lines are in time order).
  const current = useMemo(() => {
    let [low, high] = [0, lines.length - 1];
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (time < lines[mid].start) high = mid - 1;
      else if (time >= lines[mid].end) low = mid + 1;
      else return mid;
    }
    return -1;
  }, [lines, time]);
  const spoken =
    current >= 0
      ? (lines[current].words.find((word) => time >= word.start && time < word.end)?.index ?? -1)
      : -1;
  useEffect(() => {
    if (open !== null || search) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-line="${current}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [current, open, search]);
  // The clip's own words, in order, and which of them are cut.
  const clipWords = useMemo(
    () =>
      lines
        .flatMap((line) => line.words)
        .filter((word) => word.start >= clip.start - 0.01 && word.end <= clip.end + 0.01),
    [lines, clip.start, clip.end],
  );
  const cutSet = useMemo(() => cutWords(clipWords, removed), [clipWords, removed]);
  const inClipWord = useMemo(() => new Set(clipWords.map((word) => word.index)), [clipWords]);
  const suggestedSet = useMemo(() => new Set(suggested.flatMap((item) => item.words)), [suggested]);
  const wordText = useMemo(
    () => new Map(clipWords.map((word) => [word.index, word.text])),
    [clipWords],
  );
  // The rows' actions, one stable object, always calling the latest handlers.
  const handlers = useRef({ onSeek, onRange, onFix });
  handlers.current = { onSeek, onRange, onFix };
  const cutting_ = useRef({ inClipWord, setDrag });
  cutting_.current = { inClipWord, setDrag };
  useEffect(() => {
    if (!drag) return;
    const release = () => {
      onRemoved(toggleWords(clipWords, removed, drag.from, drag.to));
      setDrag(null);
    };
    window.addEventListener('pointerup', release, { once: true });
    return () => window.removeEventListener('pointerup', release);
  }, [drag, clipWords, removed, onRemoved]);
  const act = useMemo<LineActions>(
    () => ({
      pick: (word, extend) => {
        if (extend && anchor.current) {
          const [first, last] =
            anchor.current.start <= word.start ? [anchor.current, word] : [word, anchor.current];
          handlers.current.onRange(first.start, last.end);
          return;
        }
        anchor.current = word;
        handlers.current.onSeek(word.start);
      },
      press: (word) => {
        if (cutting_.current.inClipWord.has(word.index))
          cutting_.current.setDrag({ from: word.index, to: word.index });
      },
      pass: (word) => {
        if (cutting_.current.inClipWord.has(word.index))
          cutting_.current.setDrag((was) => (was ? { ...was, to: word.index } : was));
      },
      open: (index) => setOpen(index),
      fix: (index, text) => {
        setOpen(null);
        handlers.current.onFix(index, text);
      },
      close: () => setOpen(null),
    }),
    [],
  );
  const corrections = Object.keys(fixes ?? {}).length;

  if (!transcript) {
    return (
      <div className="transcript-panel">
        <div className="transcript-state" role="status">
          {status?.state === 'working' ? (
            <>
              <strong>Transcribing this video…</strong>
              <div className="job-bar" aria-hidden="true">
                <span
                  style={{ width: `${status.total ? (status.done / status.total) * 100 : 4}%` }}
                />
              </div>
              <p>
                {status.total
                  ? `${status.done} of ${status.total} ten-minute parts`
                  : 'Reading the sound'}
                . Every clip gets its captions from this transcript.
              </p>
            </>
          ) : status?.state === 'error' ? (
            <>
              <strong>The transcript stopped.</strong>
              <p className="caption-error">{status.text}</p>
              {transcriber && <TranscriberFields transcriber={transcriber} save={setTranscriber} />}
              <SpokenLanguage value={language} onChange={onLanguage} />
              <button type="button" className="sound-toggle" onClick={() => onTranscribe(false)}>
                Try again
              </button>
            </>
          ) : status?.state === 'connect' ? (
            <>
              <strong>Connect a speech-to-text provider.</strong>
              <p>
                Quikclip transcribes every video with Whisper, and every clip gets its captions from
                the transcript: on OpenRouter or Cloudflare, or on this computer.
              </p>
              <button type="button" className="sound-toggle" onClick={onConnect}>
                Connect OpenRouter or Cloudflare
              </button>
              <TranscriberFields transcriber={transcriber} save={setTranscriber} />
              <SpokenLanguage value={language} onChange={onLanguage} />
              <button type="button" className="text-btn" onClick={() => onTranscribe(false)}>
                Transcribe now
              </button>
            </>
          ) : status?.state === 'unavailable' ? (
            <p>{status.text}</p>
          ) : (
            <p>Reading the transcript…</p>
          )}
        </div>
      </div>
    );
  }
  if (!lines.length) {
    return (
      <div className="transcript-panel">
        <p className="transcript-state">No speech was found in this video.</p>
      </div>
    );
  }
  return (
    <div className="transcript-panel">
      <SpokenLanguage value={language} onChange={onLanguage} again={() => onTranscribe(true)} />
      <div className="transcript-tools">
        <label className="transcript-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search the transcript"
            placeholder="Search the transcript"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={`text-btn${cutting ? ' active' : ''}`}
          aria-pressed={cutting}
          title="Click or drag over the clip's words to cut them out; again to bring them back"
          onClick={() => {
            setCutting(!cutting);
            setEditing(false);
            setOpen(null);
          }}
        >
          {cutting ? <Check size={12} /> : <Scissors size={12} />}
          {cutting ? 'Done cutting' : 'Cut words'}
        </button>
        <button
          type="button"
          className={`text-btn${editing ? ' active' : ''}`}
          aria-pressed={editing}
          onClick={() => {
            setEditing(!editing);
            setCutting(false);
            setOpen(null);
          }}
        >
          {editing ? <Check size={12} /> : <Pencil size={12} />}
          {editing ? 'Done' : 'Edit words'}
        </button>
        {tighten}
      </div>
      {suggested.length > 0 && (
        <section className="ai-cuts" aria-label="Suggested cuts">
          <div className="ai-cuts-head">
            <strong>
              <Sparkles size={13} aria-hidden="true" />
              {suggested.length} suggested {suggested.length === 1 ? 'cut' : 'cuts'} ·{' '}
              {cutSeconds(suggested.map((item) => item.span))} s
            </strong>
            <span>
              <button type="button" className="text-btn" onClick={() => onTake?.(suggested)}>
                <Scissors size={12} aria-hidden="true" /> Cut all
              </button>
              <button type="button" className="text-btn" onClick={onDismiss}>
                Dismiss
              </button>
            </span>
          </div>
          <ol>
            {suggested.map((item) => (
              <li key={item.span.join('-')}>
                <button
                  type="button"
                  className="ai-cut-words"
                  title="Play from here"
                  onClick={() => onSeek(item.span[0])}
                >
                  “{item.words.map((index) => wordText.get(index) ?? '').join(' ')}”
                </button>
                {item.why && <small>{item.why}</small>}
                <button
                  type="button"
                  className="text-btn"
                  aria-label={`Cut “${item.words.map((index) => wordText.get(index) ?? '').join(' ')}”`}
                  onClick={() => onTake?.([item])}
                >
                  Cut
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      <p className="transcript-hint" aria-live="polite">
        {cutting
          ? removed.length
            ? `${cutSet.size} ${cutSet.size === 1 ? 'word' : 'words'} cut from the clip, ${cutSeconds(removed)} s. Click or drag over the clip’s words to cut more, or over cut ones to bring them back.`
            : 'Click a word in the clip, or drag across several, to cut them out. The preview skips them, the export leaves them out, and so do the captions.'
          : editing
            ? 'Click a word to correct it. Enter saves, Esc cancels, and an empty word is dropped.'
            : corrections
              ? `${corrections} ${corrections === 1 ? 'word' : 'words'} corrected. Every clip's captions use them.`
              : 'Misheard a word? Correct it here, and every clip’s captions follow.'}
      </p>
      {shown.length ? (
        <ol ref={list} className="transcript-lines" aria-label="Transcript">
          {shown.map(({ line, number }) => (
            <Line
              key={number}
              line={line}
              number={number}
              current={number === current}
              spoken={number === current ? spoken : -1}
              inClip={line.start < clip.end && clip.start < line.end}
              editing={editing}
              open={open !== null && line.words.some((w) => w.index === open) ? open : null}
              act={act}
              cutting={cutting}
              cutKey={line.words
                .filter((word) => cutSet.has(word.index))
                .map((word) => word.index)
                .join(',')}
              pendingKey={
                drag
                  ? line.words
                      .filter(
                        (word) =>
                          word.index >= Math.min(drag.from, drag.to) &&
                          word.index <= Math.max(drag.from, drag.to) &&
                          inClipWord.has(word.index),
                      )
                      .map((word) => word.index)
                      .join(',')
                  : ''
              }
              suggestKey={
                suggestedSet.size
                  ? line.words
                      .filter((word) => suggestedSet.has(word.index))
                      .map((word) => word.index)
                      .join(',')
                  : ''
              }
            />
          ))}
        </ol>
      ) : (
        <p className="transcript-state">No matching lines.</p>
      )}
      <p className="transcript-hint">
        Click a word to go there. Shift+click another to set the clip’s in and out. Marked lines are
        in the clip. Transcripts can have mistakes.
      </p>
      {removed.length > 0 && (
        <button type="button" className="text-btn" onClick={() => onRemoved([])}>
          Bring back every cut word ({cutSeconds(removed)} s)
        </button>
      )}
      <div className="transcript-downloads">
        <button type="button" className="text-btn" onClick={() => onDownload('txt')}>
          <Download size={12} /> Transcript (.txt)
        </button>
        <button type="button" className="text-btn" onClick={() => onDownload('srt')}>
          <Download size={12} /> Subtitles (.srt)
        </button>
      </div>
    </div>
  );
}
