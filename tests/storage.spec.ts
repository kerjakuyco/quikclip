import { expect, test } from '@playwright/test';

const PROJECT = '1f2e3d4c-5b6a-4978-8a7b-6c5d4e3f2a1b';

test('the desktop workspace lives in a file: read on opening, written after each change', async ({
  page,
}) => {
  await page.addInitScript((id) => {
    const w = window as unknown as Record<string, unknown>;
    const calls: [string, unknown][] = [];
    let next = 1;
    w.__calls = calls;
    w.isTauri = true;
    // Only the file has this project; localStorage is empty, as on a machine past its storage cap.
    const file = JSON.stringify({
      projects: [
        {
          id,
          title: 'From the file',
          source: 'Local video',
          path: 'C:/media/file/source.mp4',
          duration: 36,
          width: 1280,
          height: 640,
          fps: 24,
          frames: ['C:/media/file/frame-0.jpg'],
          wave: null,
          cuts: [{ id: 'c1', title: 'Opening', start: 0, end: 12, shape: 'source', fit: 'fill' }],
          selected: 'c1',
        },
      ],
      active: id,
      exports: [],
    });
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
        if (cmd === 'read_workspace') return file;
        return null;
      },
    };
    localStorage.clear();
  }, PROJECT);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'From the file' })).toBeVisible();
  await page.getByLabel('Clip name').fill('Renamed');
  await page.getByLabel('Clip name').press('Enter');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __calls: [string, { contents?: string }][] }).__calls
          .filter(([cmd]) => cmd === 'write_workspace')
          .map(([, args]) => args.contents ?? '')
          .some((text) => text.includes('"title":"Renamed"')),
      ),
    )
    .toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Saved locally' })).toBeVisible();
});
