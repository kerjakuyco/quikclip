import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';

export type Command = {
  id: string;
  /** What the row says, and what the search reads. */
  label: string;
  group: string;
  /** Extra words the search also matches, such as "vertical" for 9:16. */
  keywords?: string;
  /** A shortcut shown on the row. */
  hint?: string;
  disabled?: boolean;
  run: () => void;
};

/** How well a command matches the search: every word must appear; earlier and whole-word hits rank higher. */
export function commandScore(
  command: Pick<Command, 'label' | 'group' | 'keywords'>,
  query: string,
) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const label = command.label.toLowerCase();
  const haystack = `${label} ${command.group.toLowerCase()} ${command.keywords?.toLowerCase() ?? ''}`;
  let score = 0;
  for (const word of words) {
    const at = haystack.indexOf(word);
    if (at < 0) return 0;
    const inLabel = label.indexOf(word);
    score +=
      inLabel === 0 ? 4 : inLabel > 0 && label[inLabel - 1] === ' ' ? 3 : inLabel > 0 ? 2 : 1;
  }
  return score;
}

/**
 * Every action in the studio, found by typing (ClipCheap's command palette). Arrow keys move, Enter runs, Escape closes.
 */
export function CommandPalette({
  commands,
  close,
}: {
  commands: readonly Command[];
  close: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(
    () =>
      commands
        .map((command, order) => ({ command, order, score: commandScore(command, query) }))
        .filter((item) => item.score > 0 && !item.command.disabled)
        .sort((a, b) => (query ? b.score - a.score : 0) || a.order - b.order)
        .slice(0, 60)
        .map((item) => item.command),
    [commands, query],
  );
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  function run(command: Command | undefined) {
    if (!command) return;
    close();
    command.run();
  }
  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <label className="palette-search">
          <Search size={16} aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown[active] ? `palette-${shown[active].id}` : undefined}
            aria-label="Search commands"
            placeholder="Type a command, a clip, or a look"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setActive((n) => (shown.length ? (n + step + shown.length) % shown.length : 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(shown[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {shown.length === 0 && <p className="palette-empty">Nothing matches “{query}”.</p>}
          {shown.map((command, index) => (
            <div
              key={command.id}
              id={`palette-${command.id}`}
              role="option"
              aria-selected={index === active}
              data-index={index}
              className={`palette-row${index === active ? ' active' : ''}`}
              onMouseMove={() => setActive(index)}
              onClick={() => run(command)}
            >
              <span className="palette-label">{command.label}</span>
              <span className="palette-group">{command.group}</span>
              {command.hint && <kbd>{command.hint}</kbd>}
              {index === active && <CornerDownLeft size={13} aria-hidden="true" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
