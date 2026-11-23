import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  RectangleHorizontal,
  RectangleVertical,
  SlidersHorizontal,
  Sparkles,
  Square,
  WandSparkles,
  Trash2,
} from 'lucide-react';
import { clock, frame, parseTime, type Project, type Cut, type Shape } from '../studio';

function TimeField({
  label,
  value,
  commit,
}: {
  label: string;
  value: number;
  commit: (n: number) => void;
}) {
  const [text, set] = useState(clock(value, true));
  useEffect(() => set(clock(value, true)), [value]);
  return (
    <label className="time-field">
      <span>{label}</span>
      <input
        aria-label={label}
        value={text}
        onChange={(e) => set(e.target.value)}
        onBlur={() => {
          const n = parseTime(text);
          if (Number.isFinite(n)) commit(n);
          set(clock(value, true));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function Inspector({
  p,
  cut,
  select,
  update,
  trim,
  analyze,
  remove,
}: {
  p: Project;
  cut: Cut;
  select: (c: Cut) => void;
  update: (c: Partial<Cut>) => void;
  trim: (k: 'start' | 'end', n: number) => void;
  analyze: () => void;
  remove: () => void;
}) {
  const [title, setTitle] = useState(cut.title);
  useEffect(() => setTitle(cut.title), [cut.id, cut.title]);
  return (
    <aside className="inspector panel">
      <div className="panel-heading">
        <h2>
          <Sparkles className="accent" />
          Clip assistant
        </h2>
        <span className="ai-chip">AI</span>
      </div>
      <div className="ai-box">
        <span className="ai-orbit">
          <WandSparkles size={23} />
        </span>
        <div>
          <strong>Highlight finder</strong>
          <p>Discover standout moments with local AI.</p>
        </div>
        <button onClick={analyze}>
          <Sparkles size={14} /> Find highlights <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="bin-title">
        <span className="eyebrow">Clip bin</span>
        <span className="count">{String(p.cuts.length).padStart(2, '0')}</span>
      </div>
      <div className="cut-list">
        {p.cuts.map((c, i) => (
          <button
            key={c.id}
            className={`cut-card ${cut.id === c.id ? 'selected' : ''}`}
            onClick={() => select(c)}
            aria-pressed={cut.id === c.id}
          >
            <span className="cut-thumb">
              <img src={frame(p, c.start)} alt="" />
              <i>{String(i + 1).padStart(2, '0')}</i>
            </span>
            <span className="cut-copy">
              <strong>{c.title}</strong>
              <small>
                {clock(c.start)} <span>–</span> {clock(c.end)}
              </small>
            </span>
            {cut.id === c.id && <Check className="accent" size={14} />}
          </button>
        ))}
      </div>
      <div className="cut-settings">
        <div className="settings-head">
          <h3>
            <SlidersHorizontal size={15} />
            Cut settings
          </h3>
          <button
            className="icon-btn"
            title="Remove selected clip"
            aria-label="Remove selected clip"
            disabled={p.cuts.length === 1}
            onClick={remove}
          >
            <Trash2 size={14} />
          </button>
        </div>
        <label className="field-label">
          Clip name
          <input
            value={title}
            maxLength={64}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const t = title.trim();
              if (t) update({ title: t });
              else setTitle(cut.title);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
        <div className="times">
          <TimeField label="In point" value={cut.start} commit={(n) => trim('start', n)} />
          <TimeField label="Out point" value={cut.end} commit={(n) => trim('end', n)} />
        </div>
        <span className="field-label">Output frame</span>
        <div className="format-options">
          {(
            [
              ['source', 'Original', RectangleHorizontal],
              ['vertical', '9:16', RectangleVertical],
              ['square', '1:1', Square],
            ] as const
          ).map(([shape, label, Icon]) => (
            <button
              key={shape}
              className={cut.shape === shape ? 'active' : ''}
              aria-pressed={cut.shape === shape}
              onClick={() => update({ shape: shape as Shape })}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
