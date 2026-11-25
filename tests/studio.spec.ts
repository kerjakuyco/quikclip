import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { stat } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { logoFit, pngSize } from '../src/logo';
import { musicAt } from '../src/music';
import {
  clipClock,
  keptRanges,
  parseSilences,
  pauseSummary,
  planFromSilences,
  silencesIn,
} from '../src/pauses';
import { cutSpeed, playedLength, SPEEDS, VoicePace } from '../src/speed';
import {
  buildCues,
  captionMoment,
  captionTop,
  captionWords,
  correctedWords,
  cutCaptions,
  editCue,
  paceCues,
  languageTag,
  readingLines,
  toSrt,
  transcriptLines,
  transcriptText,
} from '../src/captions';

function crc32(data: Buffer) {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}
function pngChunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}
/** A 32×16 PNG with a transparent strip, large enough for the logo limits. */
function pngLogo() {
  const width = 32;
  const height = 16;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 4;
      raw[i] = 255;
      raw[i + 1] = 80;
      raw[i + 2] = 40;
      raw[i + 3] = x < 8 ? 0 : 220;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function wavTone() {
  const rate = 8000;
  const frames = Math.floor(rate * 0.4);
  const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + frames * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0.2 * 32767);
    data.writeInt16LE(sample, 44 + i * 2);
  }
  return data;
}

test('music follows the clip clock', () => {
  const track = { volume: 0.2, fade_in: 0.5, fade_out: 1, loop: true, start: 0 };
  expect(musicAt(0, track, 60, 20)).toEqual({ position: 0, volume: 0 });
  expect(musicAt(0.25, track, 60, 20)).toEqual({ position: 0.25, volume: 0.1 });
  expect(musicAt(10, { ...track, start: 30, volume: 0.5 }, 60, 20)).toEqual({
    position: 40,
    volume: 0.5,
  });
  expect(musicAt(19.5, track, 60, 20).volume).toBeCloseTo(0.1);
  expect(musicAt(15, { ...track, start: 50 }, 60, 20).position).toBe(5);
  expect(musicAt(15, { ...track, start: 50, loop: false }, 60, 20)).toEqual({
    position: null,
    volume: 0,
  });
  expect(musicAt(1, { ...track, fade_in: 5, fade_out: 5 }, 60, 2).volume).toBeCloseTo(0.2);
  expect(musicAt(21, track, 60, 20).position).toBeNull();
});

test('logo sits in the corner clip-ai uses', () => {
  const wide = logoFit(1920, 1080, 400, 200, 'bottom-right');
  expect(wide.boxWidth).toBe(216);
  expect(wide.boxHeight).toBe(108);
  expect(wide.margin).toBe(43);
  expect(wide.x).toBe('W-w-43');
  expect(wide.y).toBe('H-h-43');
  expect([wide.fitWidth, wide.fitHeight, wide.fitX, wide.fitY]).toEqual([216, 108, 1661, 929]);
  const tall = logoFit(1080, 1920, 100, 400, 'bottom-right');
  expect(tall.topInset).toBe(173);
  expect(tall.bottomInset).toBe(384);
  expect(tall.x).toBe('W-w-43');
  expect(tall.y).toBe('H-h-384');
  expect([tall.fitWidth, tall.fitHeight, tall.fitX, tall.fitY]).toEqual([27, 108, 1010, 1428]);
  expect(logoFit(1080, 1920, 400, 200, 'top-left').y).toBe('173');
  const phone = logoFit(360, 640, 32, 16, 'top-right');
  expect([
    phone.boxWidth,
    phone.boxHeight,
    phone.margin,
    phone.topInset,
    phone.bottomInset,
  ]).toEqual([72, 36, 14, 58, 128]);
  expect(phone.x).toBe('W-w-14');
  expect(phone.y).toBe('58');
  expect([phone.fitWidth, phone.fitHeight, phone.fitX, phone.fitY]).toEqual([72, 36, 274, 58]);
  expect([
    logoFit(360, 640, 80, 40, 'bottom-right').fitX,
    logoFit(360, 640, 80, 40, 'bottom-right').fitY,
  ]).toEqual([274, 476]);
  const source = logoFit(1280, 640, 200, 100, 'top-right');
  expect([source.boxWidth, source.boxHeight, source.margin]).toEqual([128, 64, 26]);
  expect([source.fitWidth, source.fitHeight, source.fitX, source.fitY]).toEqual([
    128, 64, 1126, 26,
  ]);
  expect([
    logoFit(640, 640, 64, 128, 'bottom-left').fitX,
    logoFit(640, 640, 64, 128, 'bottom-left').fitY,
  ]).toEqual([26, 550]);
  const half = logoFit(100, 250, 40, 20, 'top-left');
  expect([half.boxWidth, half.boxHeight, half.margin, half.topInset, half.bottomInset]).toEqual([
    20, 10, 4, 23, 50,
  ]);
  expect(half.x).toBe('4');
  expect(half.y).toBe('23');
  expect(pngSize(pngLogo())).toEqual({ width: 32, height: 16 });
  expect(() =>
    pngSize(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    ),
  ).toThrow(/at least 16/);
});

test('pauses drop half a second of quiet and leave the rest', () => {
  const log =
    '[silencedetect @ x] silence_start: 1.0\n[silencedetect @ x] silence_end: 2.2 | silence_duration: 1.2\n';
  expect(parseSilences(log, 3.2)).toEqual([[1, 2.2]]);
  expect(keptRanges(parseSilences(log, 3.2), 3.2)).toEqual([
    [0, 1.12],
    [2.08, 3.2],
  ]);
  expect(keptRanges(parseSilences('silence_start: 1.5\n', 3), 3)).toEqual([[0, 1.62]]);
  expect(planFromSilences([[0, 1]], 3, 10).cuts).toEqual([{ start: 10, end: 10.88 }]);
  expect(planFromSilences([[1, 1.5]], 4, 0).count).toBe(0);
  expect(planFromSilences([[0, 10]], 10, 0).kept).toBeNull();
  const rate = 1000;
  const tone = new Float32Array(rate * 1.5);
  for (let i = 0; i < rate * 0.2; i++) tone[i] = 0.5;
  for (let i = rate; i < tone.length; i++) tone[i] = 0.5;
  const plan = planFromSilences(silencesIn(tone, rate, 1, 1.5), 1.5, 10);
  expect(plan.count).toBe(1);
  expect(plan.seconds).toBeCloseTo(0.56);
  expect(plan.cuts).toEqual([{ start: 10.32, end: 10.88 }]);
  expect(silencesIn(new Float32Array(rate), rate, 1, 1)).toEqual([[0, 1]]);
  expect(planFromSilences([[0, 1]], 1, 0).count).toBe(0);
  const pauses = [{ start: 12, end: 13 }];
  expect(clipClock(11, 10, pauses)).toBe(1);
  expect(clipClock(12.5, 10, pauses)).toBe(2);
  expect(clipClock(15, 10, pauses)).toBe(4);
  expect(clipClock(9, 10, pauses)).toBe(0);
  expect(pauseSummary(plan)).toBe('1 pause marked, about 0.6 s shorter');
  expect(pauseSummary({ cuts: [], kept: null, count: 0, seconds: 0, spoken: 1 })).toBe(
    'No pauses in this moment',
  );
  expect(
    pauseSummary({
      cuts: [
        { start: 1, end: 2 },
        { start: 3, end: 4 },
      ],
      kept: null,
      count: 2,
      seconds: 1.24,
      spoken: 1,
    }),
  ).toBe('2 pauses marked, about 1.2 s shorter');
});

function sine(rate: number, seconds: number, freq: number) {
  const data = new Float32Array(Math.floor(rate * seconds));
  for (let i = 0; i < data.length; i++) data[i] = Math.sin((2 * Math.PI * freq * i) / rate);
  return data;
}
function correlation(data: Float32Array, lag: number) {
  let score = 0;
  let energy = 0;
  const from = Math.floor(data.length * 0.3);
  const to = Math.floor(data.length * 0.7);
  for (let i = from; i < to; i++) {
    energy += data[i] * data[i];
    score += data[i] * (data[i - lag] ?? 0);
  }
  return score / energy;
}
function chipmunk(input: Float32Array, speed: number) {
  const data = new Float32Array(Math.floor(input.length / speed));
  for (let i = 0; i < data.length; i++) {
    const pos = i * speed;
    const index = Math.floor(pos);
    const frac = pos - index;
    const left = input[index] ?? 0;
    data[i] = left + ((input[index + 1] ?? left) - left) * frac;
  }
  return data;
}

test('speed shortens the clip and keeps the voice pitch', () => {
  expect(SPEEDS).toEqual([1, 1.1, 1.25, 1.5]);
  expect(cutSpeed({})).toBe(1);
  expect(cutSpeed({ speed: 1 })).toBe(1);
  expect(cutSpeed({ speed: 1.2 })).toBe(1);
  expect(cutSpeed({ speed: 2 })).toBe(1);
  expect(cutSpeed({ speed: 1.1 })).toBe(1.1);
  expect(cutSpeed({ speed: 1.25 })).toBe(1.25);
  expect(cutSpeed({ speed: 1.5 })).toBe(1.5);
  expect(playedLength(1.5, 0, 1)).toBe(1.5);
  expect(playedLength(1.5, 0.5, 1)).toBe(1);
  expect(playedLength(1.5, 0, 1.5)).toBe(1);
  expect(playedLength(1.5, 0, 1.25)).toBeCloseTo(1.2);
  expect(playedLength(3, 0, 2)).toBe(3);
  const pauses = [{ start: 12, end: 13 }];
  expect(clipClock(15, 10, pauses, 1)).toBe(4);
  expect(clipClock(15, 10, pauses, 1.5)).toBeCloseTo(4 / 1.5);
  expect(clipClock(11, 10, pauses)).toBe(1);
  const rate = 16000;
  const input = sine(rate, 0.6, 440);
  const lag = Math.round(rate / 440);
  const fastLag = Math.round(lag / 1.5);
  const whole = new VoicePace().push(input, 1, rate, 0, 1.5);
  expect(whole).toHaveLength(1);
  const paced = whole[0].data;
  expect(paced.length).toBeGreaterThan((input.length / 1.5) * 0.7);
  expect(paced.length).toBeLessThan((input.length / 1.5) * 1.15);
  expect(correlation(paced, lag)).toBeGreaterThan(0.5);
  expect(correlation(paced, lag)).toBeGreaterThan(correlation(paced, fastLag) + 0.15);
  const raised = chipmunk(input, 1.5);
  expect(correlation(raised, fastLag)).toBeGreaterThan(correlation(raised, lag));
  const chunked = new VoicePace();
  const parts: Float32Array[] = [];
  for (let at = 0; at < input.length; at += 400) {
    const slice = input.subarray(at, Math.min(input.length, at + 400));
    for (const piece of chunked.push(slice, 1, rate, at / rate, 1.5)) parts.push(piece.data);
  }
  const joined = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    joined.set(part, cursor);
    cursor += part.length;
  }
  expect(joined.length).toBeGreaterThan((input.length / 1.5) * 0.7);
  expect(joined.length).toBeLessThan((input.length / 1.5) * 1.15);
  expect(correlation(joined, lag)).toBeGreaterThan(correlation(joined, fastLag) + 0.15);
});

test('edit and persist a cut, then render the selected range', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Alpine field notes' })).toBeVisible();
  await page.locator('.cut-card').nth(2).click();
  await page.getByRole('button', { name: 'Cut out pauses', exact: true }).click();
  await expect(page.locator('.pause-note')).toHaveText(
    /1 pause marked, about \d+(\.\d)? s shorter/,
    {
      timeout: 20_000,
    },
  );
  await page.locator('.cut-card').nth(1).click();
  await page.getByLabel('In point', { exact: true }).fill('13');
  await page.getByLabel('In point', { exact: true }).press('Enter');
  await page.getByLabel('Out point', { exact: true }).fill('14.5');
  await page.getByLabel('Out point', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '9:16', exact: true }).click();
  await page.getByRole('button', { name: 'Show the whole video', exact: true }).click();
  await page.getByLabel('Headline', { exact: true }).fill('Valley light');
  await page.getByLabel('Headline', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Clearer voice', exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'I own this music or have permission to use it.' })
    .click();
  await expect(page.getByRole('button', { name: 'Add music', exact: true })).toBeEnabled();
  await page.getByLabel('Music file').setInputFiles({
    name: 'bed.wav',
    mimeType: 'audio/wav',
    buffer: wavTone(),
  });
  await expect(page.locator('.music-name')).toHaveText('bed');
  await page.getByLabel('Music volume').evaluate((node) => {
    const input = node as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '40');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.getByLabel('Music volume')).toHaveValue('40');
  await expect(page.getByRole('button', { name: 'Show my logo', exact: true })).toBeVisible();
  await page.getByLabel('Logo file').setInputFiles({
    name: 'mark.png',
    mimeType: 'image/png',
    buffer: pngLogo(),
  });
  await expect(page.locator('.logo-name')).toHaveText('mark');
  await expect(page.getByRole('button', { name: 'Top right', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const placed = logoFit(360, 640, 32, 16, 'top-right');
  const shown = page.locator('.stage .logo');
  await expect(shown).toHaveAttribute('data-logo-corner', 'top-right');
  await expect(shown).toHaveAttribute(
    'style',
    expect.stringContaining(`left: ${placed.left * 100}%`),
  );
  await expect(shown).toHaveAttribute(
    'style',
    expect.stringContaining(`top: ${placed.top * 100}%`),
  );
  await expect.poll(() => shown.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(32);
  await page.getByRole('button', { name: 'Bottom left', exact: true }).click();
  const moved = logoFit(360, 640, 32, 16, 'bottom-left');
  await expect(shown).toHaveAttribute('data-logo-corner', 'bottom-left');
  await expect(shown).toHaveAttribute(
    'style',
    expect.stringContaining(`left: ${moved.left * 100}%`),
  );
  await expect(shown).toHaveAttribute('style', expect.stringContaining(`top: ${moved.top * 100}%`));
  const speeds = page.getByRole('group', { name: 'Speed' });
  await expect(speeds.getByRole('button', { name: '1×', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await speeds.getByRole('button', { name: '1.5×', exact: true }).click();
  await expect(speeds.getByRole('button', { name: '1.5×', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).playbackRate))
    .toBe(1.5);
  await page.getByRole('button', { name: 'Cut out pauses', exact: true }).click();
  await expect(page.locator('.pause-note')).toHaveText('No pauses in this moment', {
    timeout: 20_000,
  });
  await page.reload();
  await expect(page.getByLabel('In point', { exact: true })).toHaveValue('00:13.00');
  await expect(page.getByLabel('Out point', { exact: true })).toHaveValue('00:14.50');
  await expect(page.getByRole('button', { name: '9:16', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByRole('button', { name: 'Show the whole video', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.stage.blur-fill')).toBeVisible();
  await expect(page.getByLabel('Headline', { exact: true })).toHaveValue('Valley light');
  await expect(page.locator('.headline')).toContainText('Valley light');
  await expect(page.getByRole('button', { name: 'Clearer voice', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Cut out pauses', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.pause-note')).toHaveText('No pauses in this moment', {
    timeout: 20_000,
  });
  await expect(page.locator('.music-name')).toHaveText('bed');
  await expect(page.getByLabel('Music volume')).toHaveValue('40');
  await expect(page.locator('.logo-name')).toHaveText('mark');
  await expect(page.getByRole('button', { name: 'Bottom left', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.stage .logo')).toHaveAttribute('data-logo-corner', 'bottom-left');
  await expect(
    page.getByRole('group', { name: 'Speed' }).getByRole('button', { name: '1.5×', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).playbackRate))
    .toBe(1.5);
  await expect(
    page.getByRole('checkbox', { name: 'I own this music or have permission to use it.' }),
  ).toHaveCount(0);
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeGreaterThan(12);
  await expect
    .poll(() => page.locator('audio').evaluate((a) => (a as HTMLAudioElement).readyState))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => page.locator('audio').evaluate((a) => (a as HTMLAudioElement).currentTime))
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.locator('audio').evaluate((a) => (a as HTMLAudioElement).playbackRate))
    .toBe(1);
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).playbackRate))
    .toBe(1.5);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  await expect(page.locator('.specs')).toContainText('bed');
  await expect(page.locator('.specs')).toContainText('40%');
  await expect(page.locator('.specs')).toContainText('No pauses in this moment');
  await expect(page.locator('.specs')).toContainText('mark');
  await expect(page.locator('.specs')).toContainText('Bottom left');
  await expect(page.locator('.specs')).toContainText('1.5×');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export WebM', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('Into the valley.webm');
  expect((await stat((await download.path())!)).size).toBeGreaterThan(1000);
  await page.getByLabel('In point', { exact: true }).fill('34.5');
  await page.getByLabel('In point', { exact: true }).press('Enter');
  await page.getByLabel('Out point', { exact: true }).fill('36');
  await page.getByLabel('Out point', { exact: true }).press('Enter');
  await expect(page.locator('.pause-note')).toHaveText(/1 pause marked, about/, {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  await expect(page.locator('.specs')).toContainText('pause marked');
  const again = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export WebM', exact: true }).click();
  const shortened = await again;
  expect((await stat((await shortened.path())!)).size).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  await expect(page.locator('.export-row').first()).toContainText('Into the valley');
});

test('import a real local file, reopen its saved bytes and play it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import media', exact: true }).click();
  await page.getByRole('button', { name: 'Video link', exact: true }).click();
  await expect(page.getByLabel('Video link')).toBeVisible();
  await expect(page.locator('.subnote')).toContainText('YouTube, Twitch, and Kick');
  await page.getByRole('button', { name: 'Local video', exact: true }).click();
  await page.getByLabel('Video file').setInputFiles('public/sample/alpine.mp4');
  await expect(page.getByRole('heading', { name: 'alpine', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'alpine', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeGreaterThan(0.2);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Add clip' }).click();
  await expect(page.locator('.cut-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Media library', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(2);
});

test('delete an imported project after confirming, keeping the last one', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  await page.getByRole('button', { name: 'Import media', exact: true }).click();
  await page.getByLabel('Video file').setInputFiles('public/sample/alpine.mp4');
  await expect(page.getByRole('heading', { name: 'alpine', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const remove = page
    .locator('.project-nav')
    .getByRole('button', { name: 'Delete alpine', exact: true });
  await page.locator('.project-row', { hasText: /^alpine$/ }).hover();
  await remove.click();
  const dialog = page.getByRole('dialog', { name: 'Delete project' });
  await expect(dialog).toContainText('“alpine” and its 1 clip will be removed');
  await dialog.getByRole('button', { name: 'Keep project' }).click();
  await expect(page.locator('.project-row', { hasText: /^alpine$/ })).toHaveCount(1);
  await page.locator('.project-row', { hasText: /^alpine$/ }).hover();
  await remove.click();
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Deleted “alpine”');
  await expect(page.locator('.project-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.project-row')).toHaveCount(1);
  const stored = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('quikclip-media');
        req.onsuccess = () => {
          const count = req.result.transaction('videos').objectStore('videos').count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  expect(stored).toBe(0);
});

test('captions are cut, paced and edited as clip-ai does', () => {
  const words = [
    { start: 10.0, end: 10.3, text: 'Hello' },
    { start: 10.3, end: 10.6, text: 'there.' },
    { start: 10.9, end: 11.2, text: 'Again' },
  ];
  // Words stay on the source clock; cues are cut for the clip (here 9 s to 14 s) on its own clock.
  const cues = buildCues(words, 9, 14);
  expect(cues.map((cue) => cue.text)).toEqual(['Hello there.', 'Again']);
  expect(cues[0].start).toBe(1);
  // Paced as captions.rs paces them: 80 ms ahead, held until the next cue.
  const paced = paceCues(cues, 5);
  expect(paced[0].start).toBeCloseTo(0.92, 3);
  expect(paced[0].end).toBe(paced[1].start);
  expect(captionMoment(paced[0], 1.25).active).toBe(1);
  // Every clip starts in Bold at the bottom, white with a lime highlight.
  const look = cutCaptions({});
  expect(look).toEqual({
    style: 'bold',
    position: 'bottom',
    color: '#FFFFFF',
    highlight: '#D1F780',
  });
  // A line changed by hand gives the clip its own lines; the rest still come from the transcript.
  const edited = editCue(look, words, cues[1], 'Once more', 9, 14);
  expect(edited.from).toBe(9);
  expect(buildCues(captionWords(words, edited), 9, 14).map((cue) => cue.text)).toEqual([
    'Hello there.',
    'Once more',
  ]);
  expect(captionWords(words, transcriptLines(edited))).toBe(words);
  // A word corrected in the transcript keeps its time; an emptied one goes.
  const fixed = correctedWords(words, { 1: 'friend.', 2: '' });
  expect(fixed).toEqual([words[0], { ...words[1], text: 'friend.' }]);
  const lines = readingLines(
    {
      segments: [
        { start: 10, end: 10.6, text: 'Hello there.' },
        { start: 10.9, end: 11.2, text: 'Again' },
      ],
      words,
    },
    { 1: 'friend.' },
  );
  expect(lines.map((line) => line.words.map((w) => `${w.index}:${w.text}`))).toEqual([
    ['0:Hello', '1:friend.'],
    ['2:Again'],
  ]);
  expect(cutCaptions({ captions: { color: '#123456', style: 'shout' as never } })).toMatchObject({
    color: '#FFFFFF',
    style: 'bold',
  });
  // Subtitles and the transcript as files.
  expect(toSrt(paceCues(buildCues(words, 9.5, 14), 4.5))).toBe(
    '1\n00:00:00,420 --> 00:00:01,320\nHello there.\n\n2\n00:00:01,320 --> 00:00:02,350\nAgain\n',
  );
  expect(transcriptText('Talk', lines)).toBe('Talk\n\n[0:10] Hello friend.\n[0:10] Again\n');
  expect([
    languageTag('en'),
    languageTag('chinese'),
    languageTag('ja-JP'),
    languageTag(''),
  ]).toEqual(['en', 'zh', 'ja', undefined]);
  expect(captionTop(1080, 1920, 'bold', null, 56)).toBe(Math.round(1920 * 0.14));
  expect(captionTop(1080, 1920, 'bold', 400, 56)).toBe(Math.round(400 + 70 * 0.35));
});

test('captions show over the preview and are styled and edited in the inspector', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.cut-card')).toHaveCount(3);
  // Captions as a desktop transcription leaves them, on the first sample clip (0 s to 12 s).
  await page.evaluate(() => {
    const projects = JSON.parse(localStorage.getItem('quikclip.1.projects') ?? '[]');
    projects[0].cuts[0].captions = {
      words: [
        { start: 0.5, end: 1.0, text: 'Snow' },
        { start: 1.0, end: 1.6, text: 'on' },
        { start: 1.6, end: 2.4, text: 'peaks.' },
        { start: 3.0, end: 3.5, text: 'Clouds' },
        { start: 3.5, end: 4.2, text: 'below.' },
      ],
      from: 0,
      to: 12,
      style: 'bold',
      position: 'bottom',
      color: '#FFFFFF',
      highlight: '#D1F780',
    };
    localStorage.setItem('quikclip.1.projects', JSON.stringify(projects));
  });
  await page.reload();
  const lines = page.getByRole('list', { name: 'Caption lines' });
  await expect(lines.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByLabel('caption 1', { exact: false }).first()).toHaveValue(
    'Snow on peaks.',
  );
  await page.locator('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 1.3));
  const stage = page.locator('.caption-stage');
  await expect(stage).toContainText('peaks.', { ignoreCase: true });
  await expect(stage.locator('.caption-bold [data-active]')).toHaveText('on');
  // Pop boxes the word being said; Top places the captions near the top of the frame.
  await page
    .getByRole('group', { name: 'Caption style' })
    .getByRole('button', { name: 'Pop' })
    .click();
  await expect(stage.locator('.caption-pop [data-active]')).toHaveText('on');
  await page
    .getByRole('group', { name: 'Caption position' })
    .getByRole('button', { name: 'Top' })
    .click();
  const [box, frame] = await Promise.all([
    stage.locator('.caption-pop').boundingBox(),
    page.locator('.stage').boundingBox(),
  ]);
  expect(box!.y - frame!.y).toBeLessThan(frame!.height / 2);
  await page
    .getByRole('radiogroup', { name: 'Caption highlight' })
    .getByRole('radio', { name: 'Yellow' })
    .click();
  await expect(stage.locator('.caption-pop [data-active]')).toHaveCSS(
    'background-color',
    'rgb(255, 229, 0)',
  );
  // A fixed word keeps the line's time.
  const first = lines.locator('textarea').first();
  await first.fill('Snow on the peaks.');
  await first.blur();
  await expect(first).toHaveValue('Snow on the peaks.');
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  await expect(page.locator('.specs')).toContainText('Pop · 2 lines');
});

test('every desktop video is transcribed and its clips get captions and a transcript', async ({
  page,
}) => {
  // The desktop app with its Rust side stood in for: no transcript on disk yet, so it is made with the saved provider.
  await page.addInitScript(() => {
    const words = [
      { start: 0.5, end: 1.0, text: 'Snow' },
      { start: 1.0, end: 1.6, text: 'on' },
      { start: 1.6, end: 2.4, text: 'peaks.' },
      { start: 3.0, end: 3.5, text: 'Clouds' },
      { start: 3.5, end: 4.2, text: 'below.' },
    ];
    const w = window as unknown as Record<string, unknown>;
    const calls: [string, unknown][] = [];
    let next = 1;
    w.__calls = calls;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      transformCallback: (callback: unknown) => {
        const id = next++;
        w[`_${id}`] = callback;
        return id;
      },
      convertFileSrc: (path: string) =>
        path.endsWith('.mp4') ? '/sample/alpine.mp4' : '/sample/lake.jpg',
      invoke: async (cmd: string, args: unknown) => {
        calls.push([cmd, args]);
        if (cmd === 'plugin:event|listen') return next++;
        if (cmd === 'transcribe_source')
          return {
            language: 'en',
            segments: [
              { start: 0.5, end: 2.4, text: 'Snow on peaks.' },
              { start: 3.0, end: 4.2, text: 'Clouds below.' },
            ],
            words,
          };
        return null;
      },
    };
    if (!localStorage.getItem('quikclip.1.projects')) {
      localStorage.setItem(
        'quikclip.1.ai.providers',
        JSON.stringify({
          active: 'cloudflare',
          profiles: {
            cloudflare: {
              connection: { provider: 'cloudflare', accountId: 'a'.repeat(32), gateway: 'default' },
              models: [],
              model: '@cf/google/gemma-4-26b-a4b-it',
              custom: false,
            },
          },
        }),
      );
      localStorage.setItem(
        'quikclip.1.projects',
        JSON.stringify([
          {
            id: '5e866d71-a76f-4d08-998f-b8bd76c96812',
            title: 'Talk',
            source: 'Local video',
            path: 'C:/media/talk/source.mp4',
            duration: 36,
            width: 1280,
            height: 640,
            fps: 24,
            frames: ['C:/media/talk/frame-0.jpg'],
            wave: null,
            cuts: [{ id: 'c1', title: 'Opening', start: 0, end: 12, shape: 'source' }],
            selected: 'c1',
          },
        ]),
      );
      localStorage.setItem(
        'quikclip.1.active',
        JSON.stringify('5e866d71-a76f-4d08-998f-b8bd76c96812'),
      );
    }
  });
  await page.goto('/');
  // Made automatically on opening, with the saved Cloudflare connection; the clip has captions from it.
  const lines = page.getByRole('list', { name: 'Caption lines' });
  await expect(lines.getByRole('listitem')).toHaveCount(2);
  const asked = await page.evaluate(() =>
    (window as unknown as { __calls: [string, { connection?: { provider: string } }][] }).__calls
      .filter(([cmd]) => cmd === 'transcribe_source')
      .map(([, args]) => args.connection?.provider),
  );
  expect(asked).toEqual(['cloudflare']);
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
  await page.locator('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 1.3));
  await expect(page.locator('.caption-stage .caption-bold [data-active]')).toHaveText('on');
  await expect(page.locator('.caption-stage')).toHaveAttribute('lang', 'en');
  // The transcript: read it, go to a word, correct a misheard one for every clip, set the clip from a stretch of words.
  await page.getByRole('tab', { name: 'Transcript' }).click();
  const transcript = page.getByRole('list', { name: 'Transcript' });
  await expect(transcript.getByRole('listitem')).toHaveCount(2);
  await transcript.getByRole('button', { name: 'Clouds' }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(3.0, 1);
  await page.getByRole('button', { name: 'Edit words' }).click();
  await transcript.getByRole('button', { name: 'peaks.' }).click();
  const fix = page.getByLabel('Correct “peaks.”');
  await fix.fill('summits.');
  await fix.press('Enter');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.transcript-hint').first()).toContainText('1 word corrected');
  await transcript.getByRole('button', { name: 'on', exact: true }).click();
  await transcript.getByRole('button', { name: 'below.' }).click({ modifiers: ['Shift'] });
  await page.getByRole('tab', { name: 'Clips' }).click();
  await expect(page.getByLabel('In point')).toHaveValue('00:01.00');
  await expect(page.getByLabel('Out point')).toHaveValue('00:04.20');
  await expect(lines.locator('textarea').first()).toHaveValue('on summits.');
  // The whole video's subtitles and its transcript, saved as files, with the correction.
  await page.getByRole('tab', { name: 'Transcript' }).click();
  await page.getByRole('button', { name: 'Subtitles (.srt)' }).click();
  await page.getByRole('button', { name: 'Transcript (.txt)' }).click();
  const saved = await page.evaluate(() =>
    (window as unknown as { __calls: [string, Record<string, string>][] }).__calls
      .filter(([cmd]) => cmd === 'save_text')
      .map(([, args]) => args),
  );
  expect(saved.map((s) => [s.name, s.extension])).toEqual([
    ['Talk', 'srt'],
    ['Talk transcript', 'txt'],
  ]);
  expect(saved[0].contents).toContain('1\n00:00:00,420 --> 00:00:02,920\nSnow on summits.\n');
  expect(saved[1].contents).toContain('[0:00] Snow on summits.');
  await page.getByRole('tab', { name: 'Clips' }).click();
  // The correction is kept with the project.
  await page.reload();
  await expect(
    page.getByRole('list', { name: 'Caption lines' }).locator('textarea').first(),
  ).toHaveValue('on summits.');
});
