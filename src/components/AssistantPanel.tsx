import {
  CircleAlert,
  Film,
  MousePointerClick,
  Palette,
  Plus,
  RotateCcw,
  Scissors,
  Search,
  SendHorizontal,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Change, StoredTurn } from '../assistant';

const EXAMPLES: [LucideIcon, string][] = [
  [Smartphone, 'Make every clip vertical with Pop captions'],
  [Search, 'Find the strongest 30 seconds and add it as a clip'],
  [Scissors, 'Cut the ums and pauses from this clip'],
  [Type, 'Add a title that sums up this clip'],
];
const CHANGE_ICONS: Record<Change['kind'], LucideIcon> = {
  add: Plus,
  edit: SlidersHorizontal,
  remove: Trash2,
  select: MousePointerClick,
  look: Palette,
  text: Type,
};
/** The tallest the message box grows before it scrolls. */
const COMPOSER_MAX = 132;

/**
 * The editing assistant: ask in your own words, and it changes the clips. Each answer is a card saying what it did,
 * with the clips it touched one click away; its edits are one undo step.
 */
export function AssistantPanel({
  turns,
  working,
  available,
  ask,
  undo,
  canUndo,
  clip,
  clipCount,
  show,
  retry,
}: {
  turns: readonly StoredTurn[];
  working: boolean;
  /** Why the assistant can't work here, if it can't. */
  available: string | null;
  ask: (text: string) => void;
  undo: () => void;
  canUndo: boolean;
  /** The selected clip's title and how many clips there are: what the assistant is looking at. */
  clip: string;
  clipCount: number;
  /** Selects a clip an answer changed. */
  show: (id: string) => void;
  /** Asks again after an answer that failed. */
  retry: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const log = useRef<HTMLOListElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: 'end' });
  }, [turns.length, working]);
  // The message box grows with what is typed, up to a few lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(COMPOSER_MAX, el.scrollHeight)}px`;
  }, [text]);
  function send(value = text) {
    const request = value.trim();
    if (!request || working || available) return;
    ask(request);
    setText('');
  }
  const lastAnswer = turns.map((turn) => turn.role).lastIndexOf('assistant');
  return (
    <div className="assistant">
      {turns.length === 0 ? (
        <div className="assistant-empty">
          <div className="assistant-hero">
            <span className="assistant-mark" aria-hidden="true">
              <Sparkles size={18} />
            </span>
            <div>
              <h3>Edit by asking</h3>
              <p>
                Say what you want in your own words. The assistant reads your clips and the
                transcript, makes the edits, and lists what changed. Undo takes back a whole answer.
              </p>
            </div>
          </div>
          <span className="field-label">Try</span>
          <div className="assistant-examples" role="group" aria-label="Examples">
            {EXAMPLES.map(([Icon, example]) => (
              <button
                key={example}
                type="button"
                disabled={working || !!available}
                onClick={() => send(example)}
              >
                <Icon size={14} aria-hidden="true" />
                <span>{example}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol className="assistant-log" ref={log} aria-label="Conversation" aria-live="polite">
          {turns.map((turn, index) =>
            turn.role === 'user' ? (
              <li key={index} className="turn turn-user">
                <p>{turn.text}</p>
              </li>
            ) : (
              <li key={index} className={`turn turn-assistant${turn.error ? ' failed' : ''}`}>
                <header className="turn-head">
                  <span className="assistant-avatar" aria-hidden="true">
                    {turn.error ? <CircleAlert size={12} /> : <Sparkles size={12} />}
                  </span>
                  <strong>{turn.error ? 'Couldn’t do that' : 'Assistant'}</strong>
                  {!!turn.edits && (
                    <span className="turn-chip">
                      {turn.edits} {turn.edits === 1 ? 'edit' : 'edits'}
                    </span>
                  )}
                </header>
                {turn.text && <p className="turn-text">{turn.text}</p>}
                {!!turn.changes?.length && (
                  <ul className="turn-changes" aria-label="What changed">
                    {turn.changes.map((change, n) => {
                      const Icon = CHANGE_ICONS[change.kind];
                      return (
                        <li key={n} data-kind={change.kind}>
                          <Icon size={13} aria-hidden="true" />
                          <span>{change.text}</span>
                          {change.clip && change.kind !== 'remove' && (
                            <button
                              type="button"
                              className="turn-show"
                              onClick={() => show(change.clip!)}
                            >
                              Show
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!!turn.skipped?.length && (
                  <ul className="turn-skipped" aria-label="Not done">
                    {turn.skipped.map((note, n) => (
                      <li key={n}>
                        <CircleAlert size={13} aria-hidden="true" />
                        <span>Skipped {note}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {((index === lastAnswer && !!turn.edits) || turn.error) && (
                  <footer className="turn-actions">
                    {index === lastAnswer && !!turn.edits && (
                      <button type="button" className="text-btn" disabled={!canUndo} onClick={undo}>
                        <Undo2 size={13} aria-hidden="true" /> Undo these changes
                      </button>
                    )}
                    {turn.error && turns[index - 1]?.role === 'user' && (
                      <button
                        type="button"
                        className="text-btn"
                        disabled={working || !!available}
                        onClick={() => retry(turns[index - 1].text)}
                      >
                        <RotateCcw size={13} aria-hidden="true" /> Try again
                      </button>
                    )}
                  </footer>
                )}
              </li>
            ),
          )}
          {working && (
            <li className="turn turn-assistant working" aria-label="The assistant is working">
              <header className="turn-head">
                <span className="assistant-avatar" aria-hidden="true">
                  <Sparkles size={12} />
                </span>
                <strong>Assistant</strong>
              </header>
              <p className="turn-thinking">
                <span className="dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                Reading your clips and the transcript…
              </p>
            </li>
          )}
        </ol>
      )}
      {available && <p className="fit-note assistant-note">{available}</p>}
      <form
        className="assistant-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="composer-context" title="What the assistant is looking at">
          <Film size={12} aria-hidden="true" />
          <span>
            <b>{clip}</b> · {clipCount} {clipCount === 1 ? 'clip' : 'clips'} in this project
          </span>
        </div>
        <div className="composer-box">
          <textarea
            ref={box}
            aria-label="Ask the assistant"
            placeholder="Ask for an edit…"
            rows={1}
            maxLength={2000}
            value={text}
            disabled={!!available}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            type="submit"
            className="composer-send"
            aria-label="Send"
            title="Send (Enter)"
            disabled={working || !text.trim() || !!available}
          >
            <SendHorizontal size={15} aria-hidden="true" />
          </button>
        </div>
        <p className="composer-hint">Enter to send · Shift + Enter for a new line</p>
      </form>
    </div>
  );
}
