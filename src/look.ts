import { cutCaptions, type CutCaptions } from './captions';
import {
  cutCrop,
  cutFit,
  cutFraming,
  cutLogo,
  cutLoudness,
  FRAME_PRESETS,
  readSaved,
  type CropPosition,
  type Cut,
  type CutLogo,
  type Fit,
  type Framing,
  type Loudness,
  type Shape,
} from './studio';

/**
 * A clip's look: its frame, framing, captions, logo, and the one-press polish. Music, headlines, and wording stay off it.
 * Looks are ClipCheap's templates: a few built in, and up to twenty of your own.
 */
export type ClipLook = {
  shape: Shape;
  fit: Fit;
  crop?: CropPosition;
  framing?: Framing;
  captions: Pick<CutCaptions, 'style' | 'position' | 'color' | 'highlight'> &
    Partial<Pick<CutCaptions, 'font' | 'scale' | 'lift'>>;
  logo?: CutLogo;
  punch?: boolean;
  fillers?: boolean;
  pauses?: boolean;
  voice?: boolean;
  loudness?: Loudness;
};
export type NamedLook = { id: string; name: string; look: ClipLook; builtIn?: boolean };

/** The most looks you can keep. */
export const MAX_LOOKS = 20;
const KEY = 'look';
const LIST = 'looks';

/** Built-in looks, in the studio's own colours (captions.ts CAPTION_COLORS). */
export const BUILT_IN_LOOKS: NamedLook[] = [
  {
    id: 'bold-creator',
    name: 'Bold creator',
    builtIn: true,
    look: {
      shape: 'vertical',
      fit: 'fill',
      framing: 'speaker',
      captions: { style: 'bold', position: 'middle', color: '#FFFFFF', highlight: '#FF8057' },
      punch: true,
      fillers: true,
      pauses: true,
      voice: true,
      loudness: 'loud',
    },
  },
  {
    id: 'clean-podcast',
    name: 'Clean podcast',
    builtIn: true,
    look: {
      shape: 'vertical',
      fit: 'split',
      framing: 'speaker',
      captions: { style: 'clean', position: 'bottom', color: '#F3E6D3', highlight: '#93C4A2' },
      fillers: true,
      voice: true,
      loudness: 'standard',
    },
  },
  {
    id: 'karaoke-pop',
    name: 'Karaoke pop',
    builtIn: true,
    look: {
      shape: 'vertical',
      fit: 'fill',
      framing: 'faces',
      captions: { style: 'karaoke', position: 'bottom', color: '#FFFFFF', highlight: '#FFD166' },
      punch: true,
      pauses: true,
      loudness: 'loud',
    },
  },
  {
    id: 'quote-card',
    name: 'Quote card',
    builtIn: true,
    look: {
      shape: 'square',
      fit: 'blur',
      captions: { style: 'pop', position: 'middle', color: '#FFFFFF', highlight: '#4CC9F0' },
      voice: true,
      loudness: 'standard',
    },
  },
];

export function lookFrom(cut: Cut): ClipLook {
  const captions = cutCaptions(cut);
  const logo = cutLogo(cut);
  const loudness = cutLoudness(cut);
  return {
    shape: cut.shape,
    fit: cutFit(cut),
    ...(cut.crop ? { crop: cutCrop(cut) } : {}),
    ...(cut.framing ? { framing: cutFraming(cut) } : {}),
    captions: {
      style: captions.style,
      position: captions.position,
      color: captions.color,
      highlight: captions.highlight,
      ...(captions.font ? { font: captions.font } : {}),
      ...(captions.scale ? { scale: captions.scale } : {}),
      ...(captions.lift ? { lift: captions.lift } : {}),
    },
    ...(logo ? { logo } : {}),
    ...(cut.punch ? { punch: true } : {}),
    ...(cut.fillers ? { fillers: true } : {}),
    ...(cut.pauses ? { pauses: true } : {}),
    ...(cut.voice ? { voice: true } : {}),
    ...(loudness ? { loudness } : {}),
  };
}

const valid = (look: ClipLook | null | undefined): look is ClipLook =>
  !!look && look.shape in FRAME_PRESETS && !!look.captions;

/** The look new clips start from, if one is set. */
export function readLook(): (ClipLook & { name?: string }) | null {
  const look = readSaved<(ClipLook & { name?: string }) | null>(KEY, null);
  return valid(look) ? look : null;
}

export function writeLook(look: ClipLook, name?: string) {
  localStorage.setItem(`quikclip.1.${KEY}`, JSON.stringify(name ? { ...look, name } : look));
}

export function clearLook() {
  localStorage.removeItem(`quikclip.1.${KEY}`);
}

/** Your saved looks, newest last. */
export function readLooks(): NamedLook[] {
  const list = readSaved<NamedLook[]>(LIST, []);
  return Array.isArray(list)
    ? list
        .filter(
          (item) =>
            item &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            valid(item.look),
        )
        .slice(-MAX_LOOKS)
        .map(({ id, name, look }) => ({ id, name: name.slice(0, 40), look }))
    : [];
}

export function writeLooks(list: NamedLook[]) {
  localStorage.setItem(
    `quikclip.1.${LIST}`,
    JSON.stringify(list.filter((item) => !item.builtIn).slice(-MAX_LOOKS)),
  );
}

/** A name not already taken: "My look", then "My look 2". */
export function freshName(name: string, taken: readonly NamedLook[]) {
  const base = name.trim().slice(0, 40) || 'My look';
  const names = new Set(taken.map((item) => item.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** The look a clip has, if it matches one of these exactly. */
export function matchingLook(cut: Cut, looks: readonly NamedLook[]) {
  const mine = JSON.stringify(lookFrom(cut));
  return looks.find((item) => JSON.stringify(lookFrom(applyLook(cut, item.look))) === mine) ?? null;
}

export function applyLook(cut: Cut, look: ClipLook | null): Cut {
  if (!valid(look)) return cut;
  const captions = cutCaptions({ captions: { ...cut.captions, ...look.captions } });
  // The look's face, size and nudge, or the plain ones when it has none.
  const lookCaptions = cutCaptions({ captions: look.captions });
  const logo = cutLogo({ logo: look.logo });
  const framing = look.framing ? cutFraming({ framing: look.framing }) : undefined;
  const fit = cutFit({ fit: look.fit, shape: look.shape });
  return {
    ...cut,
    shape: look.shape,
    fit,
    crop: look.crop,
    framing: framing === 'hand' ? undefined : framing,
    captions: {
      ...(cut.captions ?? {}),
      font: lookCaptions.font,
      scale: lookCaptions.scale,
      lift: lookCaptions.lift,
      style: captions.style,
      position: captions.position,
      color: captions.color,
      highlight: captions.highlight,
    },
    logo: logo ?? undefined,
    punch: look.punch || undefined,
    fillers: look.fillers || undefined,
    pauses: look.pauses || undefined,
    voice: look.voice ?? cut.voice,
    loudness: look.loudness,
  };
}
