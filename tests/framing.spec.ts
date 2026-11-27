import { openClipTools } from './clip-tools';
import { expect, test, type Page } from '@playwright/test';
import { speakerFaces } from '../src/camera';

// The desktop app with its Rust side stood in for, on Windows (where the system face detector lives).
test.use({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
});

const PROJECT = '5e866d71-a76f-4d08-998f-b8bd76c96812';
type Call = [string, Record<string, unknown>];

async function openDesktop(page: Page, shape = 'vertical') {
  await page.addInitScript(
    ({ id, shape }) => {
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
          // A face on the left for five seconds, then on the right.
          // Two people: the one on the left talks first, the one on the right after 6 s.
          if (cmd === 'find_faces' && (args as { speaker?: boolean }).speaker)
            return Array.from({ length: 49 }, (_, i) => ({
              time: i * 0.25,
              faces: [
                { x: 0.05, y: 0.3, w: 0.14, h: 0.22, motion: i * 0.25 < 6 ? 9 : 1 },
                { x: 0.8, y: 0.3, w: 0.12, h: 0.2, motion: i * 0.25 < 6 ? 1 : 9 },
              ],
            }));
          if (cmd === 'find_faces')
            return Array.from({ length: 25 }, (_, i) => ({
              time: i * 0.5,
              faces: [{ x: i * 0.5 < 5 ? 0.05 : 0.8, y: 0.3, w: 0.12, h: 0.2 }],
            }));
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
                { id: 'c1', title: 'Opening', start: 0, end: 12, shape, fit: 'fill' },
                { id: 'c2', title: 'Later', start: 14, end: 24, shape: 'source', fit: 'fill' },
              ],
              selected: 'c1',
            },
          ]),
        );
        localStorage.setItem('quikclip.1.active', JSON.stringify(id));
      }
    },
    { id: PROJECT, shape },
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

test('follows faces in the preview and exports the calm camera with the loudness', async ({
  page,
}) => {
  await openDesktop(page);
  const framing = page.getByRole('group', { name: 'Framing' });
  await framing.getByRole('button', { name: 'Follow faces' }).click();
  await expect(page.locator('.face-status')).toContainText('Following the largest face');
  expect(await calls(page, 'find_faces')).toEqual([
    { id: PROJECT, start: 0, end: 12, speaker: false },
  ]);
  // The crop sits on the face: far left at first, far right after it moves.
  const left = () => page.locator('video').evaluate((v: HTMLVideoElement) => v.style.left);
  await seekTo(page, 1);
  await expect.poll(left).toBe('0%');
  await seekTo(page, 9);
  await expect.poll(left).not.toBe('0%');
  // Loudness and the moving crop reach the export.
  await openClipTools(page, 'Audio');
  await page
    .getByRole('group', { name: 'Export loudness' })
    .getByRole('button', { name: 'Loud', exact: true })
    .click();
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  const summary = page.getByRole('dialog');
  await expect(
    summary.locator('div', { has: page.locator('dt', { hasText: 'Framing' }) }).locator('dd'),
  ).toHaveText('Following faces');
  await expect(
    summary.locator('div', { has: page.locator('dt', { hasText: 'Loudness' }) }).locator('dd'),
  ).toHaveText('Loud · -14 LUFS');
  await page.getByRole('button', { name: 'Choose destination' }).click();
  await expect.poll(async () => (await calls(page, 'render_clip')).length).toBe(1);
  const [{ request }] = (await calls(page, 'render_clip')) as {
    request: {
      camera: { t: number; x: number; y: number }[];
      loudness: number;
      crop: { x: number; y: number };
    };
  }[];
  expect(request.loudness).toBe(-14);
  expect(request.camera.length).toBeGreaterThan(2);
  expect(request.camera[0]).toMatchObject({ t: 0, x: 0 });
  expect(request.camera.at(-1)!.x).toBeGreaterThan(90);
  expect(Number.isInteger(request.crop.x)).toBe(true);
  // Centered framing sends one centered crop and no camera.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openClipTools(page, 'Frame');
  await framing.getByRole('button', { name: 'Center' }).click();
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  await page.getByRole('button', { name: 'Choose destination' }).click();
  await expect.poll(async () => (await calls(page, 'render_clip')).length).toBe(2);
  const centered = (
    (await calls(page, 'render_clip'))[1] as {
      request: { camera: unknown[]; crop: { x: number; y: number } };
    }
  ).request;
  expect(centered.crop).toEqual({ x: 50, y: 50 });
  expect(centered.camera).toEqual([]);
});

test('undo and redo step through clip edits but not clip selection', async ({ page }) => {
  await openDesktop(page, 'source');
  const frame = page.getByRole('group', { name: 'Output frame' });
  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeDisabled();
  await frame.getByRole('button', { name: '9:16' }).click();
  await expect(frame.getByRole('button', { name: '9:16' })).toHaveAttribute('aria-pressed', 'true');
  // Choosing another clip and back is not a step.
  await page.locator('.cut-card', { hasText: 'Later' }).click();
  await page.locator('.cut-card', { hasText: 'Opening' }).click();
  await page.locator('body').press('Control+z');
  await expect(frame.getByRole('button', { name: 'Original' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(undo).toBeDisabled();
  await page.locator('body').press('Control+Shift+z');
  await expect(frame.getByRole('button', { name: '9:16' })).toHaveAttribute('aria-pressed', 'true');
  await undo.click();
  await expect(frame.getByRole('button', { name: 'Original' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(frame.getByRole('button', { name: '9:16' })).toHaveAttribute('aria-pressed', 'true');
});

test('new clips start with the saved look until it is cleared', async ({ page }) => {
  await openDesktop(page, 'source');
  const frame = page.getByRole('group', { name: 'Output frame' });
  await frame.getByRole('button', { name: '1:1' }).click();
  await page.getByRole('button', { name: /^Looks,/ }).click();
  await page.getByRole('button', { name: 'Use for new clips' }).click();
  await expect(page.locator('.look-row')).toContainText('New clips start with a saved look');
  await page.getByRole('button', { name: 'Add clip' }).click();
  await expect(page.locator('.cut-card')).toHaveCount(3);
  await expect(frame.getByRole('button', { name: '1:1' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.look-row').getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('button', { name: 'Add clip' }).click();
  await expect(page.locator('.cut-card')).toHaveCount(4);
  await expect(frame.getByRole('button', { name: 'Original' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('the speaker takes the shot after leading, and crosstalk keeps it', () => {
  const left = (motion: number) => ({ x: 0.05, y: 0.3, w: 0.14, h: 0.22, motion });
  const right = (motion: number) => ({ x: 0.8, y: 0.3, w: 0.12, h: 0.2, motion });
  const at = (time: number, a: number, b: number) => ({ time, faces: [left(a), right(b)] });
  const picks = (samples: ReturnType<typeof at>[]) =>
    speakerFaces(samples).map((face) => (face ? (face.x < 0.5 ? 'L' : 'R') : '-'));
  // Nobody talking: the largest face. The right one talks: it takes over after leading 0.6 s.
  expect(
    picks([
      at(0, 0, 0),
      at(0.25, 0, 9),
      at(0.5, 0, 9),
      at(0.75, 0, 9),
      at(1, 0, 9),
      at(1.25, 0, 9),
    ]),
  ).toEqual(['L', 'L', 'L', 'L', 'R', 'R']);
  // Both talking alike is crosstalk: the shot stays.
  expect(picks([at(0, 9, 0), at(0.25, 6, 7), at(0.5, 7, 8), at(0.75, 6, 7), at(1, 7, 6)])).toEqual([
    'L',
    'L',
    'L',
    'L',
    'L',
  ]);
  // A short interjection doesn't take the shot either.
  expect(picks([at(0, 9, 0), at(0.25, 0, 9), at(0.5, 0, 9), at(0.75, 9, 0), at(1, 9, 0)])).toEqual([
    'L',
    'L',
    'L',
    'L',
    'L',
  ]);
});

test('follow speaker measures mouths and moves the frame to whoever talks', async ({ page }) => {
  await openDesktop(page);
  const framing = page.getByRole('group', { name: 'Framing' });
  await framing.getByRole('button', { name: 'Follow speaker' }).click();
  await expect(page.locator('.face-status')).toContainText('Following whoever is talking');
  expect(await calls(page, 'find_faces')).toEqual([
    { id: PROJECT, start: 0, end: 12, speaker: true },
  ]);
  const left = () => page.locator('video').evaluate((v: HTMLVideoElement) => v.style.left);
  await seekTo(page, 2);
  await expect.poll(left).toBe('0%');
  await seekTo(page, 10);
  await expect.poll(left).not.toBe('0%');
  // Faces found for the speaker serve Follow faces as they are.
  await framing.getByRole('button', { name: 'Follow faces' }).click();
  await expect.poll(async () => (await calls(page, 'find_faces')).length).toBe(1);
});
