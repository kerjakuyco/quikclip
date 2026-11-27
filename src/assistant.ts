import {
  CAPTION_POSITIONS,
  CAPTION_STYLES,
  cutCaptions,
  type CaptionPosition,
  type CaptionStyle,
} from './captions';
import { applyLook, type NamedLook } from './look';
import { SPEEDS } from './speed';
import {
  clock,
  cutFit,
  FRAME_PRESETS,
  mediaOf,
  newId,
  round,
  type Cut,
  type Fit,
  type Framing,
  type Loudness,
  type Project,
  type Shape,
} from './studio';
import { MAX_TEXTS, TEXT_ANIMATIONS, TEXT_PRESETS, type TextLayer } from './texts';

/**
 * The editing assistant (ClipCheap's composition assistant): the model reads the project and the transcript, and answers
 * with a reply and edits. Every edit is checked here before it touches the project, and they apply as one undo step.
 */
export type Turn = { role: 'user' | 'assistant'; text: string };
/** One edit the assistant made, as the studio describes it under the reply. `clip` is the clip it is about. */
export type Change = {
  kind: 'add' | 'edit' | 'remove' | 'select' | 'look' | 'text';
  text: string;
  clip?: string;
};
/** A turn as the studio keeps it: the reply, and what it changed or could not. */
export type StoredTurn = Turn & {
  edits?: number;
  changes?: Change[];
  skipped?: string[];
  error?: boolean;
};

const FIT_WORDS: Record<string, string> = {
  fill: 'fill the frame',
  blur: 'whole video',
  split: 'split layout',
  stack: 'facecam layout',
};
const FRAMING_WORDS: Record<string, string> = {
  center: 'centered',
  faces: 'follows faces',
  speaker: 'follows the speaker',
};

/** What an edit to a clip's settings did, in a few words each. */
function patchWords(patch: Partial<Cut>): string[] {
  const words: string[] = [];
  if (patch.title !== undefined) words.push(`renamed “${patch.title}”`);
  if (patch.start !== undefined && patch.end !== undefined)
    words.push(`trimmed to ${clock(patch.start)}–${clock(patch.end)}`);
  if (patch.shape) words.push(`${FRAME_PRESETS[patch.shape].label} frame`);
  if (patch.fit) words.push(FIT_WORDS[patch.fit] ?? patch.fit);
  if ('framing' in patch) words.push(FRAMING_WORDS[patch.framing ?? ''] ?? 'framed by hand');
  if ('speed' in patch) words.push(`${patch.speed ?? 1}× speed`);
  if (patch.headline !== undefined)
    words.push(patch.headline ? `headline “${patch.headline}”` : 'no headline');
  if (patch.captions) {
    const style = CAPTION_STYLES.find((item) => item.value === patch.captions?.style);
    words.push(
      style?.value === 'none'
        ? 'captions off'
        : `${style?.label ?? 'Bold'} captions${
            patch.captions.position === 'middle'
              ? ' in the middle'
              : patch.captions.position === 'top'
                ? ' at the top'
                : ''
          }`,
    );
  }
  const toggles = [
    ['pauses', 'pauses cut', 'pauses kept'],
    ['fillers', 'ums cut', 'ums kept'],
    ['punch', 'punch-ins on', 'punch-ins off'],
    ['voice', 'clearer voice', 'original sound'],
  ] as const;
  for (const [key, on, off] of toggles) if (key in patch) words.push(patch[key] ? on : off);
  if ('loudness' in patch)
    words.push(patch.loudness ? `${patch.loudness} loudness` : 'loudness as recorded');
  return words;
}
export type Op = Record<string, unknown> & { op: string };

const MIN_CLIP = 0.25;
/** The most transcript sent, in characters. */
const TRANSCRIPT_CHARS = 90_000;

type Line = { start: number; end: number; text: string };

/** What the model is told: the videos, the clips with their settings, the looks, and the shown video's transcript. */
export function assistantContext(
  p: Project,
  cut: Cut,
  lines: readonly Line[],
  looks: readonly NamedLook[],
) {
  const shown = mediaOf(p, cut);
  const clips = p.cuts.map((item) => {
    const caps = cutCaptions(item);
    return {
      id: item.id,
      title: item.title,
      video: mediaOf(p, item).title,
      start: round(item.start),
      end: round(item.end),
      shape: item.shape,
      fit: cutFit(item),
      framing: item.framing ?? 'hand',
      speed: item.speed ?? 1,
      headline: item.headline ?? '',
      captions: caps.style,
      caption_position: caps.position,
      pauses: !!item.pauses,
      fillers: !!item.fillers,
      punch: !!item.punch,
      voice: !!item.voice,
      loudness: item.loudness ?? null,
      texts: (item.texts ?? []).map((layer) => layer.text),
    };
  });
  let transcript = '';
  for (const line of lines) {
    const next = `[${line.start.toFixed(1)}-${line.end.toFixed(1)}] ${line.text}\n`;
    if (transcript.length + next.length > TRANSCRIPT_CHARS) {
      transcript += '[the rest of the transcript is left out]\n';
      break;
    }
    transcript += next;
  }
  return JSON.stringify(
    {
      project: p.title,
      video_shown: {
        title: shown.title,
        duration: round(shown.duration),
        length: clock(shown.duration),
      },
      selected_clip: cut.id,
      clips,
      looks: looks.map((item) => item.name),
    },
    null,
    1,
  ).concat(
    `\n<transcript of the video shown>\n${transcript || '(no transcript yet)'}</transcript>`,
  );
}

/** The model's answer: its reply and its edits, from JSON perhaps fenced or with words around it. */
export function parseAssistant(answer: string): { reply: string; ops: Op[] } {
  const open = answer.indexOf('{');
  const close = answer.lastIndexOf('}');
  if (open < 0 || close <= open)
    return { reply: answer.trim().slice(0, 600) || 'No answer.', ops: [] };
  try {
    const parsed = JSON.parse(answer.slice(open, close + 1)) as { reply?: unknown; ops?: unknown };
    const ops = Array.isArray(parsed.ops)
      ? parsed.ops.filter(
          (op): op is Op => !!op && typeof op === 'object' && typeof (op as Op).op === 'string',
        )
      : [];
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim().slice(0, 600) : '';
    return { reply: reply || (ops.length ? 'Done.' : 'No changes.'), ops: ops.slice(0, 60) };
  } catch {
    return { reply: 'The answer could not be read. Try asking again.', ops: [] };
  }
}

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown, limit: number) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : null;
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]) =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;

const SHAPES = Object.keys(FRAME_PRESETS) as Shape[];
const FITS: Fit[] = ['fill', 'blur', 'split'];
const FRAMINGS: Framing[] = ['hand', 'center', 'faces', 'speaker'];
const LOUDNESS: Loudness[] = ['standard', 'loud', 'louder'];

/** A clip's settings from an `update_clip` edit, each one checked; anything unknown or out of range is left out. */
function settings(cut: Cut, set: Record<string, unknown>, duration: number): Partial<Cut> {
  const patch: Partial<Cut> = {};
  const title = text(set.title, 64);
  if (title) patch.title = title;
  const start = num(set.start);
  const end = num(set.end);
  if (start !== null || end !== null) {
    const from = Math.max(0, Math.min(duration - MIN_CLIP, start ?? cut.start));
    const to = Math.min(duration, Math.max(from + MIN_CLIP, end ?? cut.end));
    patch.start = round(from);
    patch.end = round(to);
  }
  const shape = oneOf(set.shape, SHAPES);
  if (shape) patch.shape = shape;
  const fit = oneOf(set.fit, FITS);
  if (fit) patch.fit = fit;
  const framing = oneOf(set.framing, FRAMINGS);
  if (framing) patch.framing = framing === 'hand' ? undefined : framing;
  const speed = num(set.speed);
  if (speed !== null && (SPEEDS as readonly number[]).includes(speed))
    patch.speed = speed === 1 ? undefined : speed;
  if (typeof set.headline === 'string') patch.headline = text(set.headline, 80) ?? '';
  const style = oneOf(set.captions, CAPTION_STYLES.map((item) => item.value) as CaptionStyle[]);
  const position = oneOf(
    set.caption_position,
    CAPTION_POSITIONS.map((item) => item.value) as CaptionPosition[],
  );
  if (style || position)
    patch.captions = {
      ...cutCaptions(cut),
      ...(style ? { style } : {}),
      ...(position ? { position } : {}),
    };
  for (const key of ['pauses', 'fillers', 'punch'] as const)
    if (typeof set[key] === 'boolean') patch[key] = set[key] ? true : undefined;
  if (typeof set.voice === 'boolean') patch.voice = set.voice;
  if (set.loudness === null) patch.loudness = undefined;
  const loudness = oneOf(set.loudness, LOUDNESS);
  if (loudness) patch.loudness = loudness;
  return patch;
}

/**
 * The edits applied to the project, in order: each checked against the project as it stands then. Returns the new
 * project, how many edits took, and a note for each that did not.
 */
export function applyOps(
  p: Project,
  ops: readonly Op[],
  looks: readonly NamedLook[],
  shownVideo: string,
) {
  let project = p;
  let applied = 0;
  const skipped: string[] = [];
  const changes: Change[] = [];
  const targets = (id: unknown) =>
    id === 'all' ? project.cuts : project.cuts.filter((item) => item.id === id);
  // Who an edit was for: the clip by name, or how many.
  const who = (id: unknown, found: readonly Cut[]) =>
    id === 'all' && found.length > 1
      ? 'Every clip'
      : found.length === 1
        ? `“${found[0].title}”`
        : `${found.length} clips`;
  const change = (ids: Set<string>, fn: (cut: Cut) => Cut) => {
    project = {
      ...project,
      cuts: project.cuts.map((item) => (ids.has(item.id) ? fn(item) : item)),
    };
  };
  for (const op of ops) {
    const found = targets(op.id);
    switch (op.op) {
      case 'add_clip': {
        const video = mediaOf(project, shownVideo === project.id ? null : { video: shownVideo });
        const start = num(op.start);
        const end = num(op.end);
        if (start === null || end === null || end - start < MIN_CLIP) {
          skipped.push('a clip without a usable range');
          break;
        }
        const from = round(Math.max(0, Math.min(video.duration - MIN_CLIP, start)));
        const clip: Cut = {
          id: newId(),
          title: text(op.title, 64) || `Clip ${String(project.cuts.length + 1).padStart(2, '0')}`,
          start: from,
          end: round(Math.min(video.duration, Math.max(from + MIN_CLIP, end))),
          shape: 'source',
          fit: 'fill',
          voice: true,
          ...(video.id !== project.id ? { video: video.id } : {}),
        };
        project = { ...project, cuts: [...project.cuts, clip], selected: clip.id };
        applied++;
        changes.push({
          kind: 'add',
          text: `Added “${clip.title}”, ${clock(clip.start)}–${clock(clip.end)}`,
          clip: clip.id,
        });
        break;
      }
      case 'update_clip': {
        const set = op.set && typeof op.set === 'object' ? (op.set as Record<string, unknown>) : {};
        if (!found.length) {
          skipped.push(`an edit to a clip that isn't there`);
          break;
        }
        let any = false;
        let said: string[] = [];
        change(new Set(found.map((item) => item.id)), (item) => {
          const patch = settings(item, set, mediaOf(project, item).duration);
          if (Object.keys(patch).length) any = true;
          if (!said.length) said = patchWords(patch);
          return { ...item, ...patch };
        });
        if (any) {
          applied++;
          changes.push({
            kind: 'edit',
            text: `${who(op.id, found)}: ${said.join(', ') || 'updated'}`,
            ...(found.length === 1 ? { clip: found[0].id } : {}),
          });
        } else skipped.push('an edit with no setting the studio knows');
        break;
      }
      case 'remove_clip': {
        const ids = new Set(found.map((item) => item.id));
        const rest = project.cuts.filter((item) => !ids.has(item.id));
        if (!ids.size || !rest.length) {
          skipped.push(rest.length ? `removing a clip that isn't there` : 'removing every clip');
          break;
        }
        project = {
          ...project,
          cuts: rest,
          selected: ids.has(project.selected) ? rest[0].id : project.selected,
        };
        applied++;
        changes.push({ kind: 'remove', text: `Removed ${who(op.id, found)}` });
        break;
      }
      case 'select_clip':
        if (found.length === 1) {
          project = { ...project, selected: found[0].id };
          applied++;
          changes.push({ kind: 'select', text: `Showing “${found[0].title}”`, clip: found[0].id });
        } else skipped.push(`choosing a clip that isn't there`);
        break;
      case 'apply_look': {
        const look = looks.find(
          (item) => item.name.toLowerCase() === String(op.look ?? '').toLowerCase(),
        );
        if (!look || !found.length) {
          skipped.push(look ? `a look for a clip that isn't there` : `a look that isn't there`);
          break;
        }
        change(new Set(found.map((item) => item.id)), (item) => applyLook(item, look.look));
        applied++;
        changes.push({
          kind: 'look',
          text: `${who(op.id, found)}: the “${look.name}” look`,
          ...(found.length === 1 ? { clip: found[0].id } : {}),
        });
        break;
      }
      case 'add_text': {
        const words = text(op.text, 160);
        if (!words || !found.length) {
          skipped.push('text without words or a clip');
          break;
        }
        change(new Set(found.map((item) => item.id)), (item) => {
          const span = item.end - item.start;
          const at = round(Math.max(0, Math.min(span - 0.2, num(op.at) ?? 0)));
          const layer: TextLayer = {
            id: newId(),
            text: words,
            preset:
              oneOf(
                op.preset,
                TEXT_PRESETS.map((preset) => preset.value),
              ) ?? 'title',
            at,
            length: round(Math.max(0.2, Math.min(span - at, num(op.length) ?? 3))),
            x: 0.5,
            y: 0.16,
            animation:
              oneOf(
                op.animation,
                TEXT_ANIMATIONS.map((animation) => animation.value),
              ) ?? 'pop',
          };
          return { ...item, texts: [...(item.texts ?? []), layer].slice(0, MAX_TEXTS) };
        });
        applied++;
        changes.push({
          kind: 'text',
          text: `${who(op.id, found)}: text “${words}”`,
          ...(found.length === 1 ? { clip: found[0].id } : {}),
        });
        break;
      }
      default:
        skipped.push(`an edit the studio doesn't know (${String(op.op).slice(0, 30)})`);
    }
  }
  return { project, applied, skipped, changes };
}
