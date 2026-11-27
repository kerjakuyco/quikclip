import type { LogoCorner } from './logo';
import { newId, round, type Cut, type Video } from './studio';

/**
 * B-roll (ClipCheap's b-roll layer): `length` seconds of a project video from `from`, shown `at` seconds after the
 * clip's in point (on the source clock), filling the frame (`cutaway`) or in a corner (`pip`). Its sound stays off.
 */
export type BRoll = {
  id: string;
  /** A project video's id: the project's own, or an added one's. */
  video: string;
  from: number;
  at: number;
  length: number;
  mode: 'cutaway' | 'pip';
  corner?: LogoCorner;
};
/** The most b-roll shots on one clip (media.rs MAX_BROLL). */
export const MAX_BROLL = 6;
/** A shot's shortest length. */
export const MIN_BROLL = 0.2;
/** A picture in picture's width, as a share of the frame's (media.rs broll_parts). */
export const PIP_WIDTH = 0.4;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The clip's b-roll that is still usable: on one of the project's videos, inside the clip, and long enough. */
export function cutBroll(
  cut: Pick<Cut, 'broll' | 'start' | 'end'>,
  videos: readonly Video[],
): BRoll[] {
  const span = cut.end - cut.start;
  return (cut.broll ?? [])
    .filter(
      (shot) =>
        shot &&
        typeof shot.id === 'string' &&
        videos.some((video) => video.id === shot.video) &&
        [shot.from, shot.at, shot.length].every(finite) &&
        shot.length >= MIN_BROLL &&
        shot.at >= 0 &&
        shot.at < span,
    )
    .slice(0, MAX_BROLL);
}

/** The shots showing at a source time, with how far into each it is. */
export function brollAt(shots: readonly BRoll[], start: number, time: number) {
  const into = time - start;
  return shots
    .filter((shot) => into >= shot.at && into < shot.at + shot.length)
    .map((shot) => ({ shot, offset: into - shot.at }));
}

/**
 * A new shot at the playhead: from another video when the project has one (else a later moment of this one), three
 * seconds or what's left of the clip.
 */
export function newShot(
  cut: Pick<Cut, 'start' | 'end'>,
  own: string,
  videos: readonly Video[],
  playhead: number,
): BRoll {
  const span = cut.end - cut.start;
  const at = round(Math.min(Math.max(0, playhead - cut.start), Math.max(0, span - 1)));
  const other = videos.find((video) => video.id !== own);
  const source = other ?? videos.find((video) => video.id === own) ?? videos[0];
  const length = round(Math.max(MIN_BROLL, Math.min(3, span - at, source.duration)));
  const from = other ? 0 : round(Math.max(0, Math.min(source.duration - length, cut.end + 1)));
  return { id: newId(), video: source.id, from, at, length, mode: 'cutaway' };
}

/** What an export sends for each shot. */
export function brollRequest(shots: readonly BRoll[]) {
  return shots.map(({ video, from, at, length, mode, corner }) => ({
    video,
    from,
    at,
    length,
    mode,
    corner: corner ?? 'top-right',
  }));
}
