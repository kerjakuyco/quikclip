import { expect, test, type Page } from '@playwright/test';
import { mediaOf, projectVideos, withMedia, type Project } from '../src/studio';

const PROJECT = '0c1d7a3e-5b2f-4f6a-9c8d-1e2f3a4b5c6d';
const SECOND = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';

test('a clip plays, reads and exports from its own video', () => {
  const p = {
    id: PROJECT,
    title: 'Talk',
    source: 'Local video',
    path: 'C:/a.mp4',
    duration: 36,
    width: 1280,
    height: 640,
    fps: 24,
    frames: [],
    fixes: { 1: 'fixed' },
    cuts: [],
    selected: '',
    videos: [
      {
        id: SECOND,
        title: 'Second',
        source: 'YouTube',
        path: 'C:/b.mp4',
        duration: 20,
        width: 640,
        height: 360,
        fps: 30,
        frames: [],
      },
    ],
  } as unknown as Project;
  expect(mediaOf(p, {})).toBe(p);
  const second = mediaOf(p, { video: SECOND });
  expect(second).toMatchObject({ id: SECOND, path: 'C:/b.mp4', duration: 20, width: 640 });
  // The second video's own corrections, not the first's.
  expect(second.fixes).toBeUndefined();
  // A clip of a removed video falls back to the first.
  expect(mediaOf(p, { video: 'gone' })).toBe(p);
  expect(projectVideos(p).map((v) => v.id)).toEqual([PROJECT, SECOND]);
  expect(withMedia(p, SECOND, { wave: 'w.png' }).videos![0].wave).toBe('w.png');
  expect(withMedia(p, PROJECT, { wave: 'x.png' })).toMatchObject({ id: PROJECT, wave: 'x.png' });
  expect(withMedia(p, 'gone', { wave: 'x.png' })).toBe(p);
});

type Call = [string, Record<string, unknown>];
const calls = (page: Page, cmd: string) =>
  page.evaluate(
    (name) =>
      (window as unknown as { __calls: Call[] }).__calls
        .filter(([c]) => c === name)
        .map(([, args]) => args),
    cmd,
  );

async function openDesktop(page: Page) {
  await page.addInitScript(
    ({ id, second }) => {
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
          if (cmd === 'import_local')
            return {
              id: second,
              title: 'Second',
              path: 'C:/media/second/source.mp4',
              duration: 20,
              width: 640,
              height: 360,
              fps: 30,
              frames: ['C:/media/second/frame-0.jpg'],
            };
          if (cmd === 'export_clip') return 'C:/out/clip.mp4';
          if (cmd === 'export_batch')
            return {
              folder: 'C:/out/batch',
              total: 2,
              outputs: [],
              failures: [],
              cancelled: false,
            };
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
    { id: PROJECT, second: SECOND },
  );
  await page.goto('/');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
}

test('add a video to a project, cut and export from it, switch back, and remove it', async ({
  page,
}) => {
  await openDesktop(page);
  const details = page.getByRole('group', { name: 'Source details' });
  await expect(details).toContainText('1280 × 640');
  await page.getByRole('button', { name: /Talk\s*1\/1/ }).click();
  await page
    .getByRole('group', { name: 'Project videos' })
    .getByRole('button', { name: 'Add a video to this project' })
    .click();
  const into = page.getByRole('group', { name: 'Import into' });
  await expect(into.getByRole('button', { name: 'Add to “Talk”' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Choose a video file' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Added “Second” to this project' }),
  ).toBeVisible();
  // The new video's clip is selected, and the editor shows that video.
  await expect(page.getByLabel('Clip name')).toHaveValue('Second');
  await expect(details).toContainText('640 × 360');
  await expect(details).toContainText('00:20');
  await expect(page.locator('.cut-video')).toHaveText(['V1', 'V2']);
  // Its transcript is its own.
  await expect
    .poll(async () => (await calls(page, 'read_transcript')).at(-1))
    .toEqual({ id: SECOND });
  // A single export reads the second video; a batch reads each clip's own.
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  await page.getByRole('button', { name: 'Choose destination' }).click();
  await expect.poll(async () => (await calls(page, 'export_clip')).length).toBe(1);
  expect((await calls(page, 'export_clip'))[0]).toMatchObject({ id: SECOND, end: 15 });
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  await page.getByRole('group', { name: 'Clips to export' }).getByText('Opening').click();
  await page.getByRole('button', { name: /Choose a folder · 2 files/ }).click();
  await expect.poll(async () => (await calls(page, 'export_batch')).length).toBe(1);
  const batch = (await calls(page, 'export_batch'))[0] as {
    id: string;
    requests: { video: string }[];
  };
  expect(batch.requests.map((r) => r.video).sort()).toEqual([PROJECT, SECOND].sort());
  // Back to the first video.
  await page
    .getByRole('button', { name: 'Close dialog' })
    .click()
    .catch(() => {});
  await page.getByRole('button', { name: /Second\s*2\/2/ }).click();
  await page
    .getByRole('group', { name: 'Project videos' })
    .getByRole('button', { name: /^Talk/ })
    .click();
  await expect(page.getByLabel('Clip name')).toHaveValue('Opening');
  await expect(details).toContainText('1280 × 640');
  // Remove the second video and its clips.
  await page.getByRole('button', { name: /Talk\s*1\/2/ }).click();
  await page.getByRole('button', { name: 'Remove the video Second' }).click();
  await page.getByRole('button', { name: 'Remove video' }).click();
  await expect.poll(async () => (await calls(page, 'delete_media')).at(-1)).toEqual({ id: SECOND });
  await expect(page.locator('.cut-card')).toHaveCount(1);
  await expect(page.locator('.cut-video')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Talk\s*1\/1/ })).toBeVisible();
});
