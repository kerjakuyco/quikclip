import type { Cut, Project } from './studio';

/**
 * The joined video previewed in the monitor (src-tauri join.rs plays the same order): the opening shot, the chosen
 * clips in bin order, each with its own settings, and the end card.
 */
export type SequenceItem =
  { kind: 'clip'; id: string } | { kind: 'bookend'; end: 'intro' | 'outro' };
export type Sequence = { items: SequenceItem[]; at: number };

/** The items a joined video of these clips plays, in order. */
export function sequenceItems(
  p: Pick<Project, 'cuts' | 'bookends'>,
  ids: readonly string[],
): SequenceItem[] {
  const clips = p.cuts
    .filter((cut) => ids.includes(cut.id))
    .map((cut): SequenceItem => ({ kind: 'clip', id: cut.id }));
  if (!clips.length) return [];
  return [
    ...(p.bookends?.intro ? [{ kind: 'bookend', end: 'intro' } as const] : []),
    ...clips,
    ...(p.bookends?.outro ? [{ kind: 'bookend', end: 'outro' } as const] : []),
  ];
}

/** What the monitor says while a sequence plays: "Clip 2 of 4 · Title", or the opening shot or end card. */
export function sequenceLabel(sequence: Sequence, cuts: readonly Pick<Cut, 'id' | 'title'>[]) {
  const item = sequence.items[sequence.at];
  if (!item) return '';
  if (item.kind === 'bookend') return item.end === 'intro' ? 'Opening shot' : 'End card';
  const clips = sequence.items.filter((entry) => entry.kind === 'clip');
  const number = clips.findIndex((entry) => entry.kind === 'clip' && entry.id === item.id) + 1;
  const title = cuts.find((cut) => cut.id === item.id)?.title ?? '';
  return `Clip ${number} of ${clips.length} · ${title}`;
}
