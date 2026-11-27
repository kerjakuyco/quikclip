import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowRightLeft,
  ArrowUpLeft,
  ArrowUpRight,
  AudioLines,
  Blend,
  ChevronsRight,
  Combine,
  Contrast,
  Crosshair,
  Expand,
  Files,
  Film,
  FolderPlus,
  Hand,
  ListVideo,
  PanelTop,
  PictureInPicture2,
  RectangleHorizontal,
  RectangleVertical,
  ScanFace,
  Scissors,
  Shrink,
  Speech,
  Square,
  Volume,
  Volume1,
  Volume2,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';

/** The studio's selectors each show an icon beside their label, so a choice reads at a glance. */
export const FRAME_ICONS: Record<string, LucideIcon> = {
  source: Film,
  landscape: RectangleHorizontal,
  vertical: RectangleVertical,
  square: Square,
  portrait: RectangleVertical,
};
export const FIT_ICONS: Record<string, LucideIcon> = {
  fill: Expand,
  blur: Shrink,
  split: PanelTop,
};
export const FRAMING_ICONS: Record<string, LucideIcon> = {
  hand: Hand,
  center: Crosshair,
  faces: ScanFace,
  speaker: Speech,
};
/** Loudness, from as recorded to the loudest target. */
export const LOUDNESS_ICONS: Record<string, LucideIcon> = {
  original: AudioLines,
  standard: Volume,
  loud: Volume1,
  louder: Volume2,
};
export const CORNER_ICONS: Record<string, LucideIcon> = {
  'top-left': ArrowUpLeft,
  'top-right': ArrowUpRight,
  'bottom-left': ArrowDownLeft,
  'bottom-right': ArrowDownRight,
};
export const TRANSITION_ICONS: Record<string, LucideIcon> = {
  cut: Scissors,
  fade: Contrast,
  dissolve: Blend,
  slide: ArrowRightLeft,
  wipe: ChevronsRight,
  zoom: ZoomIn,
};
export const BROLL_ICONS: Record<string, LucideIcon> = {
  cutaway: Expand,
  pip: PictureInPicture2,
};
export const IMPORT_ICONS: Record<string, LucideIcon> = {
  new: FolderPlus,
  project: ListVideo,
};
export const JOIN_ICONS: Record<string, LucideIcon> = {
  separate: Files,
  joined: Combine,
};
