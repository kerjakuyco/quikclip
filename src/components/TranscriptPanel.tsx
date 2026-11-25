import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Pencil, Search } from 'lucide-react';
import {
  readingLines,
  type IndexedWord,
  type Transcript,
  type TranscriptFixes,
  type TranscriptLine,
} from '../captions';
import { clock } from '../studio';

/** How a project's transcript is coming along when it isn't ready. */
export type TranscriptStatus =
  | { state: 'working'; done: number; total: number }
  | { state: 'error'; text: string }
  | { state: 'connect' }
  | { state: 'unavailable'; text: string };

type LineActions = {
  pick: (word: IndexedWord, extend: boolean) => void;
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
}: {
  line: TranscriptLine;
  number: number;
  current: boolean;
  spoken: number;
  inClip: boolean;
  editing: boolean;
  open: number | null;
  act: LineActions;
}) {
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
                className={`word${word.index === spoken ? ' spoken' : ''}`}
                role="button"
                tabIndex={-1}
                data-start={word.start}
                onClick={(e) => (editing ? act.open(word.index) : act.pick(word, e.shiftKey))}
                onDoubleClick={() => act.open(word.index)}
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
  onRetry,
  onConnect,
  onDownload,
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
  onRetry: () => void;
  onConnect: () => void;
  /** Saves the transcript as text, or the whole video's subtitles. */
  onDownload: (kind: 'txt' | 'srt') => void;
}) {
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim().toLowerCase());
  const [editing, setEditing] = useState(false);
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
  // The rows' actions, one stable object, always calling the latest handlers.
  const handlers = useRef({ onSeek, onRange, onFix });
  handlers.current = { onSeek, onRange, onFix };
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
              <button type="button" className="sound-toggle" onClick={onRetry}>
                Try again
              </button>
            </>
          ) : status?.state === 'connect' ? (
            <>
              <strong>Connect a speech-to-text provider.</strong>
              <p>
                Quikclip transcribes every video with Whisper on OpenRouter or Cloudflare, and every
                clip gets its captions from the transcript.
              </p>
              <button type="button" className="sound-toggle" onClick={onConnect}>
                Open Highlight finder
              </button>
              <button type="button" className="text-btn" onClick={onRetry}>
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
          className={`text-btn${editing ? ' active' : ''}`}
          aria-pressed={editing}
          onClick={() => {
            setEditing(!editing);
            setOpen(null);
          }}
        >
          {editing ? <Check size={12} /> : <Pencil size={12} />}
          {editing ? 'Done' : 'Edit words'}
        </button>
      </div>
      <p className="transcript-hint" aria-live="polite">
        {editing
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
