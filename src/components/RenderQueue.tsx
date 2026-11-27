import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Clapperboard,
  Combine,
  Files,
  LoaderCircle,
  X,
} from 'lucide-react';
import { queueSummary, renderStatus, type RenderTask } from '../renders';

const KIND_ICONS = { clip: Clapperboard, batch: Files, joined: Combine };

/** The render queue in the status bar: a one-line summary that opens the list of renders. */
export function RenderQueue({
  tasks,
  cancel,
  remove,
  clear,
}: {
  tasks: readonly RenderTask[];
  cancel: (task: RenderTask) => void;
  remove: (task: RenderTask) => void;
  clear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  if (!tasks.length) return null;
  const running = tasks.find((task) => task.status === 'running');
  const finished = tasks.some((task) => !['queued', 'running'].includes(task.status));
  return (
    <div className="render-queue" ref={box}>
      <button
        type="button"
        className="render-summary"
        aria-expanded={open}
        aria-controls="render-list"
        aria-label={`Render queue: ${queueSummary(tasks)}`}
        onClick={() => setOpen((on) => !on)}
      >
        {running ? (
          <LoaderCircle className="spin" size={13} aria-hidden="true" />
        ) : (
          <Clapperboard size={13} aria-hidden="true" />
        )}
        <span>{queueSummary(tasks)}</span>
        {running && (
          <i className="render-meter" aria-hidden="true">
            <b style={{ width: `${running.progress * 100}%` }} />
          </i>
        )}
      </button>
      {open && (
        <div className="render-panel" id="render-list" role="group" aria-label="Renders">
          <div className="render-head">
            <strong>Renders</strong>
            <button type="button" className="text-btn" disabled={!finished} onClick={clear}>
              Clear finished
            </button>
          </div>
          <ul>
            {tasks.map((task) => {
              const Icon = KIND_ICONS[task.kind];
              const live = task.status === 'queued' || task.status === 'running';
              return (
                <li key={task.id} className={`render-item ${task.status}`}>
                  <Icon size={15} aria-hidden="true" />
                  <span className="render-copy">
                    <strong>{task.title}</strong>
                    <small title={task.status === 'done' ? task.output : undefined}>
                      {task.status === 'done' && <CheckCircle2 size={12} aria-hidden="true" />}
                      {task.status === 'failed' && <CircleAlert size={12} aria-hidden="true" />}
                      {renderStatus(task)}
                    </small>
                    {task.status === 'running' && (
                      <i className="render-meter" aria-hidden="true">
                        <b style={{ width: `${task.progress * 100}%` }} />
                      </i>
                    )}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${live ? 'Cancel' : 'Remove'} ${task.title}`}
                    title={live ? 'Cancel this render' : 'Remove from the list'}
                    onClick={() => (live ? cancel(task) : remove(task))}
                  >
                    <X size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
