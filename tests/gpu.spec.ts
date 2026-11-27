import { expect, test } from '@playwright/test';

const PROJECT = '6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d';

test('exports encode on the graphics card unless that is turned off, and the choice stays', async ({
  page,
}) => {
  await page.addInitScript((id) => {
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
            cuts: [{ id: 'c1', title: 'Opening', start: 0, end: 6, shape: 'source', fit: 'fill' }],
            selected: 'c1',
          },
        ]),
      );
      localStorage.setItem('quikclip.1.active', JSON.stringify(id));
    }
  }, PROJECT);
  const sent = () =>
    page.evaluate(() =>
      (window as unknown as { __calls: [string, { on: boolean }][] }).__calls
        .filter(([cmd]) => cmd === 'set_gpu_exports')
        .map(([, args]) => args.on),
    );
  await page.goto('/');
  await expect.poll(sent).toEqual([true]);
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  const toggle = page.getByRole('button', { name: 'Encode on the graphics card' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(sent).toEqual([true, false]);
  await page.reload();
  await expect.poll(sent).toEqual([false]);
});
