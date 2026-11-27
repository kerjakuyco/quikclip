import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { JobProgress, type JobStep } from './JobProgress';

/** The media job running in the desktop app (src-tauri jobs.rs), when this window didn't start it or its dialog is closed. */
export type RunningJob = { title: string; since: number; step: JobStep | null };

/** How far a job is, in a few words: "Downloading 42%". */
export function jobSummary(job: RunningJob) {
  const label = job.step?.label || job.title.replace(/…$/, '');
  const percent = job.step?.fraction == null ? '' : ` ${Math.round(job.step.fraction * 100)}%`;
  return `${label}${percent}`;
}

/**
 * The running job in the status bar: what it is and how far along, opening its steps and a Cancel button. A job keeps
 * running when its dialog closes or the window reloads; this is where it stays in view.
 */
export function BackgroundJob({ job, cancel }: { job: RunningJob | null; cancel: () => void }) {
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
  useEffect(() => {
    if (!job) setOpen(false);
  }, [job]);
  if (!job) return null;
  const fraction = job.step?.fraction;
  return (
    <div className="render-queue background-job" ref={box}>
      <button
        type="button"
        className="render-summary"
        aria-expanded={open}
        aria-label={`Running: ${jobSummary(job)}`}
        onClick={() => setOpen((on) => !on)}
      >
        <LoaderCircle className="spin" size={13} aria-hidden="true" />
        <span>{jobSummary(job)}</span>
        {fraction != null && (
          <i className="job-chip-meter" aria-hidden="true">
            <i style={{ width: `${Math.round(fraction * 100)}%` }} />
          </i>
        )}
      </button>
      {open && (
        <div className="render-panel job-panel" role="group" aria-label="Running job">
          <div className="render-head">
            <strong>{job.title.replace(/…$/, '')}</strong>
            <button
              type="button"
              className="icon-btn"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <X size={13} />
            </button>
          </div>
          {job.step ? (
            <JobProgress step={job.step} since={job.since} onCancel={cancel} />
          ) : (
            <div className="busy" role="status">
              <LoaderCircle className="spin" size={16} />
              Working…
              <button type="button" className="text-btn" onClick={cancel}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
