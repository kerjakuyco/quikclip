import { Bot, LoaderCircle, SendHorizontal, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Turn } from '../assistant';

const EXAMPLES = [
  'Make every clip vertical with Pop captions',
  'Find the strongest 30 seconds and add it as a clip',
  'Cut the ums and pauses from this clip',
  'Add a title that sums up this clip',
];

/**
 * The editing assistant: ask in your own words, and it changes the clips. Each answer's edits are one undo step.
 */
export function AssistantPanel({
  turns,
  working,
  available,
  ask,
  undo,
  canUndo,
}: {
  turns: readonly (Turn & { edits?: number })[];
  working: boolean;
  /** Why the assistant can't work here, if it can't. */
  available: string | null;
  ask: (text: string) => void;
  undo: () => void;
  canUndo: boolean;
}) {
  const [text, setText] = useState('');
  const log = useRef<HTMLOListElement>(null);
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: 'end' });
  }, [turns.length, working]);
  function send(value = text) {
    const request = value.trim();
    if (!request || working || available) return;
    ask(request);
    setText('');
  }
  return (
    <div className="assistant">
      {turns.length === 0 ? (
        <div className="assistant-empty">
          <Bot size={22} aria-hidden="true" />
          <p>
            Ask for changes in your own words. The assistant reads the clips and the transcript and
            edits for you; undo takes back each answer.
          </p>
          <div className="assistant-examples" role="group" aria-label="Examples">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                disabled={working || !!available}
                onClick={() => send(example)}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol className="assistant-log" ref={log} aria-label="Conversation" aria-live="polite">
          {turns.map((turn, index) => (
            <li key={index} className={`turn turn-${turn.role}`}>
              <p>{turn.text}</p>
              {turn.role === 'assistant' && !!turn.edits && index === turns.length - 1 && (
                <button type="button" className="text-btn" disabled={!canUndo} onClick={undo}>
                  <Undo2 size={13} aria-hidden="true" /> Undo these changes
                </button>
              )}
            </li>
          ))}
          {working && (
            <li className="turn turn-assistant working">
              <p>
                <LoaderCircle className="spin" size={13} aria-hidden="true" /> Working on it…
              </p>
            </li>
          )}
        </ol>
      )}
      {available && <p className="fit-note assistant-note">{available}</p>}
      <form
        className="assistant-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          aria-label="Ask the assistant"
          placeholder="Ask for an edit…"
          rows={2}
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
          className="btn primary"
          aria-label="Send"
          disabled={working || !text.trim() || !!available}
        >
          <SendHorizontal size={15} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
