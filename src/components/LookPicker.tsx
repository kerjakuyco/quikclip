import { useState, type ReactNode } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { FRAME_PRESETS } from '../studio';
import type { NamedLook } from '../look';

/**
 * Looks (ClipCheap's templates), folded to one line that names the clip's look. Opened, a row of chips each applies its
 * frame, framing, captions, and polish in one press; your own looks can be saved from the clip as it is, and removed.
 */
export function LookPicker({
  looks,
  current,
  apply,
  save,
  remove,
  full,
  children,
}: {
  looks: readonly NamedLook[];
  /** The look this clip has, when it matches one exactly. */
  current: NamedLook | null;
  apply: (look: NamedLook) => void;
  save: (name: string) => void;
  remove: (look: NamedLook) => void;
  /** No room for another saved look. */
  full: boolean;
  /** Shown at the foot of the open picker: the look new clips start with. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const shown = current?.name ?? 'Custom';
  return (
    <div className="looks" role="group" aria-labelledby="looks-title">
      <div className="looks-head">
        <span className="field-label" id="looks-title">
          Look
        </span>
        <button
          type="button"
          className="look-toggle"
          aria-expanded={open}
          aria-controls="look-panel"
          aria-label={`Looks, ${shown}`}
          onClick={() => setOpen((on) => !on)}
        >
          {current && (
            <i style={{ background: current.look.captions.highlight }} aria-hidden="true" />
          )}
          <span>{shown}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="look-panel" id="look-panel">
          <div className="look-chips">
            {looks.map((item) => {
              const on = current?.id === item.id;
              return (
                <span key={item.id} className={`look-chip${on ? ' active' : ''}`}>
                  <button
                    type="button"
                    aria-pressed={on}
                    title={`${item.name}: ${FRAME_PRESETS[item.look.shape].label}, ${item.look.captions.style} captions`}
                    onClick={() => apply(item)}
                  >
                    <i style={{ background: item.look.captions.highlight }} aria-hidden="true" />
                    {item.name}
                    <small aria-hidden="true">{FRAME_PRESETS[item.look.shape].label}</small>
                  </button>
                  {!item.builtIn && (
                    <button
                      type="button"
                      className="look-remove"
                      aria-label={`Remove the look ${item.name}`}
                      onClick={() => remove(item)}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
          {naming ? (
            <form
              className="look-save"
              onSubmit={(e) => {
                e.preventDefault();
                save(name);
                setNaming(false);
              }}
            >
              <input
                autoFocus
                aria-label="Look name"
                placeholder="Name this look"
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setNaming(false);
                }}
              />
              <button type="submit" className="btn secondary">
                Save
              </button>
              <button type="button" className="text-btn" onClick={() => setNaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="text-btn look-new"
              disabled={full}
              title={full ? 'Remove a saved look to save another' : 'Save this clip’s look'}
              onClick={() => {
                setName('');
                setNaming(true);
              }}
            >
              <Plus size={13} aria-hidden="true" /> Save this look
            </button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
