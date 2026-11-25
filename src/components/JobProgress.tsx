import { useEffect, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { clock } from '../studio';

/** A `studio-step` event from the desktop app (progress.rs `Step`). */
export type JobStep = {
  steps: string[];
  index: number;
  label: string;
  fraction: number | null;
  detail: string | null;
  about: string | null;
};

/** Seconds since `since`, ticking once a second. */
export function useElapsed(since: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since ? (now - since) / 1000 : 0;
}

export function JobProgress({
  step,
  since,
  onCancel,
}: {
  step: JobStep;
  since: number;
  onCancel?: () => void;
}) {
  const elapsed = useElapsed(since);
  const percent = step.fraction == null ? null : Math.round(step.fraction * 100);
  return (
    <div className="job">
      {step.about && <p className="job-about">{step.about}</p>}
      {step.steps.length > 1 && (
        <ol className="job-steps" aria-label="Steps">
          {step.steps.map((name, i) => {
            const state = i < step.index ? 'done' : i === step.index ? 'now' : 'next';
            return (
              <li key={name} className={state} aria-current={state === 'now' ? 'step' : undefined}>
                <span className="job-mark">
                  {state === 'done' ? <Check size={11} strokeWidth={3} /> : i + 1}
                </span>
                {name}
              </li>
            );
          })}
        </ol>
      )}
      <div className="job-head">
        <LoaderCircle className="spin" size={15} />
        <strong role="status">{step.label}</strong>
        <span className="job-numbers">
          {percent != null && <b>{percent}%</b>}
          <span title="Elapsed">{clock(elapsed)}</span>
        </span>
      </div>
      <div
        className={`job-bar ${percent == null ? 'unknown' : ''}`}
        role="progressbar"
        aria-label={step.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <span style={percent == null ? undefined : { width: `${percent}%` }} />
      </div>
      <div className="job-foot">
        <span className="job-detail">{step.detail}</span>
        {onCancel && (
          <button className="text-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
