import { mergeSpans, type Span } from './polish';
import { spansOf } from './textcut';
import { MAX_TEXTS, type TextLayer } from './texts';
import { newId, type Cut } from './studio';

/**
 * Suggestions in place (src-tauri suggest.rs): the sparkle buttons by the fields they fill. Each asks the user's model
 * one thing about the selected clip, and what comes back is offered where the editing happens: titles under the clip
 * name, hooks under the headline, cuts in the transcript, keywords in the captions, callouts in the Layers lane.
 */
export type SuggestTask = 'titles' | 'hooks' | 'tighten' | 'keywords' | 'callouts';
export type WordCut = { from: number; to: number; why: string };
export type Callout = { text: string; at: number; length: number };
export type Suggestion =
  | { task: 'titles' | 'hooks'; options: string[] }
  | { task: 'tighten'; cuts: WordCut[] }
  | { task: 'keywords'; words: string[] }
  | { task: 'callouts'; texts: Callout[] };

type Word = { start: number; end: number; text: string };

/** What the model reads about a clip: its title and headline, and its words with when each starts in the clip. */
export function clipPayload(
  cut: Pick<Cut, 'title' | 'headline' | 'start' | 'end'>,
  words: readonly Word[],
  language: string | null | undefined,
) {
  return {
    title: cut.title,
    headline: cut.headline ?? '',
    words: words.map((word) => ({
      text: word.text,
      at: Math.round(Math.max(0, word.start - cut.start) * 100) / 100,
    })),
    length: Math.round((cut.end - cut.start) * 100) / 100,
    language: language ?? null,
  };
}

/** A suggested cut, on the source clock, with the words it takes out and why. */
export type SuggestedCut = { span: Span; words: number[]; why: string };

/**
 * The model's cuts (word numbers in the list it was sent) as spans of the source clock, each padded into the quiet
 * around its words as a cut made by hand is (textcut.ts).
 */
export function suggestedCuts(
  words: readonly (Word & { index: number })[],
  cuts: readonly WordCut[],
): SuggestedCut[] {
  return cuts.flatMap((cut) => {
    const run = words.slice(cut.from, cut.to + 1);
    if (!run.length) return [];
    const [span] = spansOf(words, new Set(run.map((word) => word.index)));
    return span ? [{ span, words: run.map((word) => word.index), why: cut.why }] : [];
  });
}

/** The clip's word cuts with some suggested ones taken. */
export function takeCuts(removed: readonly Span[] | undefined, taken: readonly SuggestedCut[]) {
  return mergeSpans([...(removed ?? []), ...taken.map((cut) => cut.span)]);
}

/** Callouts as text layers: labels low in the frame, popping in, up to the clip's room for text. */
export function calloutLayers(callouts: readonly Callout[], existing: number): TextLayer[] {
  return callouts.slice(0, Math.max(0, MAX_TEXTS - existing)).map((callout) => ({
    id: newId(),
    text: callout.text,
    preset: 'label',
    at: callout.at,
    length: callout.length,
    x: 0.5,
    y: 0.7,
    animation: 'pop',
  }));
}
