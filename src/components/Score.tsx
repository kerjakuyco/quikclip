import { useId, type CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';
import type { Highlight } from '../highlights';

/**
 * An AI moment's editorial scores, as ClipCheap shows them (clip-clients project-moments-card ScoreRing and ScoreParts,
 * clip-details ScoreBreakdown): the total in a ring, the four parts it is made of, how the clip opens, and why.
 */
export const SCORE_PARTS = [
  { key: 'hook', label: 'Hook', tip: 'How strongly it opens' },
  { key: 'clarity', label: 'Clarity', tip: 'How easy it is to follow on its own' },
  { key: 'emotion', label: 'Emotion', tip: 'How much feeling it carries' },
  { key: 'payoff', label: 'Payoff', tip: 'How well it ends' },
] as const;

/** How strong a score reads: the accent at 85 and over, fainter from 70, quiet below. */
export function scoreTone(score: number) {
  return score >= 85 ? 'strong' : score >= 70 ? 'good' : 'quiet';
}

/** The total as a ring filled to the score, the number inside. */
export function ScoreRing({ score, size = 40 }: { score: number; size?: number }) {
  return (
    <span
      className="score-ring"
      data-tone={scoreTone(score)}
      title="Scored from what’s said, not a prediction of views"
      style={{ '--score': score, '--ring': `${size}px` } as CSSProperties}
    >
      <span className="sr-only">Score </span>
      {score}
      <span className="sr-only"> out of 100</span>
    </span>
  );
}

/** The four parts of the score, each a labelled bar. */
export function ScoreParts({ parts }: { parts: NonNullable<Highlight['parts']> }) {
  return (
    <dl className="score-parts">
      {SCORE_PARTS.map(({ key, label, tip }) => {
        const value = parts[key];
        return (
          <div key={key} title={`${label}: ${tip}`} data-tone={scoreTone(value + 5)}>
            <dt>{label}</dt>
            <dd>{value}</dd>
            <dd className="score-bar" aria-hidden="true">
              <i style={{ width: `${value}%` }} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Its opening words, ended as a quote: a cut-off line gets an ellipsis instead of its trailing comma. */
export function openingLine(text: string) {
  const line = text.trim().replace(/[\s,;:\-–—]+$/, '');
  return /[.!?…"”')]$/.test(line) ? line : `${line}…`;
}

/** A suggested clip's score card, in its settings: the total, its parts, how it opens, and why it was chosen. */
export function ScoreCard({ highlight }: { highlight: Highlight }) {
  const heading = useId();
  return (
    <section className="score-card" aria-labelledby={heading}>
      <div className="score-card-head">
        {highlight.score !== undefined && <ScoreRing score={highlight.score} />}
        <div>
          <p id={heading} className="score-card-title">
            <Sparkles size={12} aria-hidden="true" /> AI suggestion
            {highlight.score !== undefined && (
              <>
                {' '}
                · <b>{highlight.score}/100</b>
              </>
            )}
          </p>
          <p className="score-card-note">Editorial estimate, not a prediction of views.</p>
        </div>
      </div>
      {highlight.parts && <ScoreParts parts={highlight.parts} />}
      {highlight.opening && (
        <p className="score-opening">Opens with “{openingLine(highlight.opening)}”</p>
      )}
      {highlight.reason && (
        <p className="score-why">
          <b>Why: </b>
          {highlight.reason}
        </p>
      )}
    </section>
  );
}
