import { openClipTools } from './clip-tools';
import { expect, test, type Page } from '@playwright/test';
import { fillerRanges, punchRanges, sentenceStarts } from '../src/polish';

const PROJECT = '7b0c9a52-3f1d-4c7e-9d3a-2a6f0e5b8c41';
// Two ums, and four sentences: the second and fourth are punched in.
const WORDS = [
  [0.2, 0.4, 'So'],
  [0.5, 0.8, 'um,'],
  [0.9, 1.3, 'today'],
  [1.4, 1.5, 'we'],
  [1.6, 2.0, 'climb.'],
  [3.0, 3.2, 'The'],
  [3.3, 3.6, 'ridge'],
  [3.7, 3.9, 'uh'],
  [4.0, 4.1, 'is'],
  [4.2, 4.6, 'steep.'],
  [6.0, 6.3, 'Then'],
  [6.4, 6.5, 'we'],
  [6.6, 7.0, 'rest.'],
  [9.0, 9.4, 'Done.'],
].map(([start, end, text]) => ({
  start: start as number,
  end: end as number,
  text: text as string,
}));

test('fillers and sentences come from the timed words', () => {
  expect(fillerRanges(WORDS, 0, 12)).toEqual([
    [0.48, 0.82],
    [3.68, 3.92],
  ]);
  // A filler never reaches into its neighbours, and one outside the clip is left alone.
  expect(fillerRanges(WORDS, 2.5, 12)).toEqual([[3.68, 3.92]]);
  expect(sentenceStarts(WORDS, 0, 12)).toEqual([3, 6, 9]);
  expect(punchRanges(WORDS, 0, 12)).toEqual([
    [3, 6],
    [9, 12],
  ]);
  // Too short to have sentences to zoom between.
  expect(punchRanges(WORDS, 0, 4)).toEqual([]);
});

type Call = [string, Record<string, unknown>];

async function openDesktop(page: Page) {
  await page.addInitScript(
    ({ id, words }) => {
      const w = window as unknown as Record<string, unknown>;
      const calls: [string, unknown][] = [];
      let next = 1;
      w.__calls = calls;
      w.isTauri = true;
      w.__TAURI_INTERNALS__ = {
        transformCallback: (callback: unknown) => {
          const n = next++;
          w[`_${n}`] = callback;
          return n;
        },
        convertFileSrc: (path: string) =>
          path.endsWith('.mp4') ? '/sample/alpine.mp4' : '/sample/lake.jpg',
        invoke: async (cmd: string, args: unknown) => {
          calls.push([cmd, args]);
          if (cmd === 'plugin:event|listen') return next++;
          if (cmd === 'read_transcript') return { language: 'en', segments: [], words };
          if (cmd === 'pick_music') return { path: 'C:/music/bed.mp3', name: 'Bed', duration: 30 };
          if (cmd === 'pick_export_file') return 'C:/out/clip.mp4';
          if (cmd === 'pick_export_folder') return 'C:/out';
          if (cmd === 'render_clip') return 'C:/out/clip.mp4';
          return null;
        },
      };
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.clear();
        localStorage.setItem(
          'quikclip.1.projects',
          JSON.stringify([
            {
              id,
              title: 'Talk',
              source: 'Local video',
              path: 'C:/media/talk/source.mp4',
              duration: 36,
              width: 1280,
              height: 640,
              fps: 24,
              frames: ['C:/media/talk/frame-0.jpg'],
              wave: null,
              cuts: [
                { id: 'c1', title: 'Opening', start: 0, end: 12, shape: 'source', fit: 'fill' },
              ],
              selected: 'c1',
            },
          ]),
        );
        localStorage.setItem('quikclip.1.active', JSON.stringify(id));
      }
    },
    { id: PROJECT, words: WORDS },
  );
  await page.goto('/');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
}

const calls = (page: Page, cmd: string) =>
  page.evaluate(
    (name) =>
      (window as unknown as { __calls: Call[] }).__calls
        .filter(([c]) => c === name)
        .map(([, args]) => args),
    cmd,
  );

async function seekTo(page: Page, time: number) {
  await page.locator('video').evaluate((v: HTMLVideoElement, t) => (v.currentTime = t), time);
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(time, 1);
}

async function exportOnce(page: Page, count: number) {
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  await page.getByRole('button', { name: 'Choose destination' }).click();
  await expect.poll(async () => (await calls(page, 'render_clip')).length).toBe(count);
  return ((await calls(page, 'render_clip'))[count - 1] as { request: Record<string, unknown> })
    .request;
}

test('cuts ums, punches in on every other sentence, splits the frame, and ducks music', async ({
  page,
}) => {
  await openDesktop(page);
  // Fillers, from the transcript.
  await openClipTools(page, 'Audio');
  const fillers = page.getByRole('button', { name: 'Cut ums and fillers' });
  await expect(fillers).toContainText('2 fillers (um, uh, er) found, about 0.6 s.');
  await fillers.click();
  await expect(fillers).toHaveAttribute('aria-pressed', 'true');
  await openClipTools(page, 'Frame');
  // Punch-ins.
  const punch = page.getByRole('button', { name: 'Punch-in zooms' });
  await expect(punch).toContainText('2 zooms in this clip');
  await punch.click();
  await seekTo(page, 1);
  await expect(page.locator('.stage-media')).not.toHaveClass(/punched/);
  await seekTo(page, 4.5);
  await expect(page.locator('.stage-media')).toHaveClass(/punched/);
  // Music that dips under speech.
  await openClipTools(page, 'Audio');
  await page.getByText('I own this audio or have permission to use it.').click();
  await page.getByRole('button', { name: 'Add music' }).click();
  await page.getByLabel('Lower under speech').check();
  const first = await exportOnce(page, 1);
  expect(first.drops).toEqual([
    [0.48, 0.82],
    [3.68, 3.92],
  ]);
  expect(first.zooms).toEqual([
    [3, 6],
    [9, 12],
  ]);
  expect(first.musicMix).toMatchObject({ duck: true });

  // The split layout on a vertical frame: the face band on top, the whole picture below.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openClipTools(page, 'Frame');
  const frame = page.getByRole('group', { name: 'Output frame' });
  await frame.getByRole('button', { name: '16:9' }).click();
  const fit = page.getByRole('group', { name: 'Frame fit' });
  await expect(fit.getByRole('button', { name: 'Split: face on top' })).toHaveCount(0);
  await frame.getByRole('button', { name: '9:16' }).click();
  await fit.getByRole('button', { name: 'Split: face on top' }).click();
  await expect(page.locator('.stage-whole canvas')).toBeVisible();
  const face = await page.locator('.stage-face').evaluate((el) => (el as HTMLElement).style.height);
  expect(parseFloat(face)).toBeCloseTo(41.9, 0);
  // Crop sliders move the face band, which has room to travel up and down too.
  await expect(page.getByRole('slider', { name: 'Vertical crop position' })).toBeVisible();
  const second = await exportOnce(page, 2);
  expect(second).toMatchObject({ shape: 'vertical', fit: 'split', crop: { x: 50, y: 50 } });
});
