import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react';

/** How the studio's AI is reached from a field: whether it can run, and connecting a model when it can't. */
export type AiAccess = {
  /** Why it can't run here (the browser, or no model chosen yet), or null when it can. */
  blocked: string | null;
  connect: () => void;
};

/**
 * A sparkle button beside the field it fills (src/suggest.ts). `run` asks the model; when it answers with options they
 * open under the button to pick from, and when it changes the clip itself (keywords, callouts) it says what it did.
 * Without a model the button says so and opens Highlight finder's model choice.
 */
export function AiSuggest({
  label,
  ai,
  run,
  pick,
  compact = false,
}: {
  /** What it does, e.g. "Suggest titles". */
  label: string;
  ai: AiAccess;
  /** Options to pick from, or a sentence saying what was done. */
  run: () => Promise<string[] | string>;
  pick?: (option: string) => void;
  /** An icon only, for tight rows. */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<string[] | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const open = options !== null || message !== null;
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);
  // A sentence saying what was done goes by itself; an error stays until it's read and closed.
  useEffect(() => {
    if (!message || message.error) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);
  function close() {
    setOptions(null);
    setMessage(null);
  }
  async function go() {
    if (ai.blocked) {
      ai.connect();
      return;
    }
    setBusy(true);
    setMessage(null);
    setOptions(null);
    try {
      const answer = await run();
      if (Array.isArray(answer)) setOptions(answer);
      else setMessage({ text: answer, error: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ai-suggest" ref={root}>
      <button
        type="button"
        className={`ai-trigger${compact ? ' compact' : ''}`}
        aria-label={label}
        aria-expanded={options !== null}
        aria-busy={busy}
        title={ai.blocked ? `${label}. ${ai.blocked}` : label}
        disabled={busy}
        onClick={() => void go()}
      >
        {busy ? (
          <LoaderCircle size={13} className="spin" aria-hidden="true" />
        ) : (
          <Sparkles size={13} aria-hidden="true" />
        )}
        {!compact && <span>{busy ? 'Thinking…' : label}</span>}
      </button>
      {open && (
        <div className="ai-pop" role="group" aria-label={`${label}: suggestions`}>
          {message && (
            <p className={message.error ? 'ai-note error' : 'ai-note'} role="status">
              {message.text}
            </p>
          )}
          {options?.map((option) => (
            <button
              key={option}
              type="button"
              className="ai-option"
              onClick={() => {
                pick?.(option);
                close();
              }}
            >
              {option}
            </button>
          ))}
          <div className="ai-pop-foot">
            <button type="button" className="text-btn" onClick={() => void go()}>
              <RotateCcw size={12} aria-hidden="true" /> Try again
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Close suggestions"
              onClick={close}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
