import { Check, ChevronDown } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type SelectOption = { value: string; label: string; disabled?: boolean };

/** Where the menu sits: under the trigger, or above it when there's more room there; never past the visible area. */
type Place = { style: CSSProperties; container: HTMLElement };

function place(trigger: HTMLElement): Place {
  // Inside a modal dialog the menu must live in the dialog (the top layer), placed against it.
  const dialog = trigger.closest('dialog');
  const container = dialog ?? document.body;
  const rect = trigger.getBoundingClientRect();
  const bounds = dialog
    ? dialog.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight, left: 0 };
  const below = bounds.bottom - rect.bottom - 8;
  const above = rect.top - bounds.top - 8;
  const up = below < 180 && above > below;
  const room = Math.max(120, Math.min(320, up ? above : below));
  const width = Math.max(rect.width, 160);
  if (!dialog) {
    return {
      container,
      style: {
        position: 'fixed',
        left: Math.min(rect.left, window.innerWidth - width - 8),
        minWidth: width,
        maxHeight: room,
        ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      },
    };
  }
  const style = getComputedStyle(dialog);
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const top = rect.top - bounds.top - borderTop + dialog.scrollTop;
  return {
    container,
    style: {
      position: 'absolute',
      left: rect.left - bounds.left - borderLeft + dialog.scrollLeft,
      minWidth: width,
      maxHeight: room,
      ...(up ? { top: top - 4, transform: 'translateY(-100%)' } : { top: top + rect.height + 4 }),
    },
  };
}

/**
 * The studio's dropdown: a button that opens a styled list, the same on every platform (native menus can't be styled).
 * Works as a select-only combobox (WAI-ARIA): arrows, Home/End, typing a name, Enter or Space to choose, Escape to close.
 */
export function Select({
  value,
  options,
  onChange,
  label,
  description,
  disabled,
  icon,
  className,
  title,
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  /** The accessible name. */
  label: string;
  description?: string;
  disabled?: boolean;
  /** Shown before the chosen option, as the timeline's magnet is. */
  icon?: ReactNode;
  className?: string;
  title?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [where, setWhere] = useState<Place | null>(null);
  const typed = useRef({ text: '', at: 0 });
  const chosen = options.findIndex((option) => option.value === value);
  const shown = options[chosen]?.label ?? '';
  const usable = (index: number) =>
    index >= 0 && index < options.length && !options[index].disabled;
  const step = (from: number, by: 1 | -1) => {
    for (let i = from + by; i >= 0 && i < options.length; i += by) if (usable(i)) return i;
    return from;
  };
  const first = () => step(-1, 1);
  const last = () => step(options.length, -1);

  function show() {
    if (disabled || !trigger.current) return;
    setWhere(place(trigger.current));
    setActive(usable(chosen) ? chosen : first());
    setOpen(true);
  }
  function close(focus = true) {
    setOpen(false);
    if (focus) trigger.current?.focus();
  }
  function pick(index: number) {
    if (!usable(index)) return;
    if (options[index].value !== value) onChange(options[index].value);
    close();
  }

  // Follow the trigger while open; close when the page moves it away or something else is clicked.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => trigger.current && setWhere(place(trigger.current));
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!trigger.current?.contains(target) && !list.current?.contains(target)) close(false);
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    document.addEventListener('mousedown', away);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      document.removeEventListener('mousedown', away);
    };
  }, [open]);
  useEffect(() => {
    if (open && active >= 0)
      list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    const key = e.key;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      setActive((at) => step(at, key === 'ArrowDown' ? 1 : -1));
    } else if (key === 'Home' || key === 'End') {
      e.preventDefault();
      setActive(key === 'Home' ? first() : last());
    } else if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      pick(active);
    } else if (key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (key === 'Tab') {
      close(false);
    } else if (key.length === 1 && /\S/.test(key)) {
      // Type the start of a name to jump to it.
      const now = Date.now();
      typed.current = {
        text: (now - typed.current.at < 600 ? typed.current.text : '') + key.toLowerCase(),
        at: now,
      };
      const match = options.findIndex(
        (option, index) =>
          usable(index) && option.label.toLowerCase().startsWith(typed.current.text),
      );
      if (match >= 0) setActive(match);
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className={`select-trigger${className ? ` ${className}` : ''}`}
        aria-label={label}
        aria-description={description}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        data-value={value}
        disabled={disabled}
        title={title}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
      >
        {icon}
        <span className="select-value">{shown}</span>
        <ChevronDown className="select-arrow" size={14} aria-hidden="true" />
      </button>
      {open &&
        where &&
        createPortal(
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            className="select-menu"
            style={where.style}
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                data-index={index}
                aria-selected={index === chosen}
                aria-disabled={option.disabled || undefined}
                className={`select-option${index === active ? ' active' : ''}`}
                onMouseMove={() => usable(index) && setActive(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(index)}
              >
                <span>{option.label}</span>
                {index === chosen && <Check size={14} aria-hidden="true" />}
              </li>
            ))}
          </ul>,
          where.container,
        )}
    </>
  );
}
