/** ClipCheap's logo box (clip-ai `logo_place`). The box is a fifth of the short side wide and a tenth tall.
 *  The image keeps its shape inside that box. On a vertical frame the top corners sit under the top bar
 *  and the bottom corners sit above the bottom buttons. Square and wide frames use one inset on every edge.
 *  Preview percentages and the ffmpeg overlay both come from this. */

export const LOGO_CORNERS = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
] as const;

export type LogoCorner = (typeof LOGO_CORNERS)[number]['value'];

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_LOGO_SIDE = 4096;
export const MIN_LOGO_SIDE = 16;

export const cornerLabel = (corner: LogoCorner) =>
  LOGO_CORNERS.find((item) => item.value === corner)?.label ?? corner;

/** Square and wide frames start bottom right. A vertical frame starts top right, under the top bar. */
export function defaultLogoCorner(width: number, height: number): LogoCorner {
  return height > width ? 'top-right' : 'bottom-right';
}

/** Even pixel count, at least 2. Matches clip-ai `even` and `even` in media.rs. */
export function even(value: number) {
  return Math.max(2, Math.round(value / 2) * 2);
}

export type LogoPlace = {
  boxWidth: number;
  boxHeight: number;
  margin: number;
  topInset: number;
  bottomInset: number;
  /** ffmpeg overlay x, using the scaled image width. */
  x: string;
  /** ffmpeg overlay y, using the scaled image height. */
  y: string;
};

export function logoPlace(width: number, height: number, corner: LogoCorner): LogoPlace {
  const short = Math.min(width, height);
  const boxWidth = even(short * 0.2);
  const boxHeight = even(short * 0.1);
  const margin = Math.round(short * 0.04);
  const vertical = height > width;
  const topInset = vertical ? Math.round(height * 0.09) : margin;
  const bottomInset = vertical ? Math.round(height * 0.2) : margin;
  const x = corner.endsWith('left') ? String(margin) : `W-w-${margin}`;
  const y = corner.startsWith('top') ? String(topInset) : `H-h-${bottomInset}`;
  return { boxWidth, boxHeight, margin, topInset, bottomInset, x, y };
}

export type LogoFit = LogoPlace & {
  fitWidth: number;
  fitHeight: number;
  fitX: number;
  fitY: number;
  /** Shares of the frame, for the preview. */
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Where the fitted image sits. ffmpeg scales into the same box and insets, then uses the image's own size. */
export function logoFit(
  frameWidth: number,
  frameHeight: number,
  logoWidth: number,
  logoHeight: number,
  corner: LogoCorner,
): LogoFit {
  const place = logoPlace(frameWidth, frameHeight, corner);
  const scale = Math.min(place.boxWidth / logoWidth, place.boxHeight / logoHeight);
  let fitWidth = Math.max(1, Math.round(logoWidth * scale));
  let fitHeight = Math.max(1, Math.round(logoHeight * scale));
  if (fitWidth > place.boxWidth) fitWidth = place.boxWidth;
  if (fitHeight > place.boxHeight) fitHeight = place.boxHeight;
  const fitX = Math.max(
    0,
    corner.endsWith('left') ? place.margin : frameWidth - fitWidth - place.margin,
  );
  const fitY = Math.max(
    0,
    corner.startsWith('top') ? place.topInset : frameHeight - fitHeight - place.bottomInset,
  );
  return {
    ...place,
    fitWidth,
    fitHeight,
    fitX,
    fitY,
    left: fitX / frameWidth,
    top: fitY / frameHeight,
    width: fitWidth / frameWidth,
    height: fitHeight / frameHeight,
  };
}

/** PNG width and height from the IHDR, or a reason the file cannot be a logo. */
export function pngSize(bytes: Uint8Array) {
  const png =
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) === 'IHDR';
  if (!png) throw Error('Use a PNG logo, ideally with a transparent background.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < MIN_LOGO_SIDE || height < MIN_LOGO_SIDE) {
    throw Error(`Logos need at least ${MIN_LOGO_SIDE} px on each side.`);
  }
  if (width > MAX_LOGO_SIDE || height > MAX_LOGO_SIDE) {
    throw Error(`Logos can be up to ${MAX_LOGO_SIDE} px on each side.`);
  }
  return { width, height };
}
