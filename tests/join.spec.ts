import { expect, test, type Page } from '@playwright/test';

const PROJECT = '3a2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d';
type Call = [string, Record<string, unknown>];
const calls = (page: Page, cmd: string) =>
  page.evaluate(
    (name) =>
      (window as unknown as { __calls: Call[] }).__calls
        .filter(([c]) => c === name)
        .map(([, args]) => args),
    cmd,
  );

test('clips join into one video, with a transition, an opening shot and an end card', async ({
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
        if (cmd === 'pick_bookend')
          return { path: 'C:/library/bookends/intro.mp4', name: 'Brand intro', duration: 2.5 };
        if (cmd === 'pick_export_file') return 'C:/out/joined.mp4';
        if (cmd === 'render_joined') return 'C:/out/joined.mp4';
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
              { id: 'c1', title: 'Opening', start: 0, end: 12, shape: 'vertical', fit: 'fill' },
              { id: 'c2', title: 'Later', start: 14, end: 24, shape: 'source', fit: 'fill' },
              { id: 'c3', title: 'End', start: 26, end: 30, shape: 'source', fit: 'fill' },
            ],
            selected: 'c2',
          },
        ]),
      );
      localStorage.setItem('quikclip.1.active', JSON.stringify(id));
    }
  }, PROJECT);
  await page.goto('/');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  await page
    .getByRole('group', { name: 'Export as' })
    .getByRole('button', { name: 'One joined video' })
    .click();
  const clips = page.getByRole('group', { name: 'Clips to export' });
  await clips.getByText('Opening').click();
  await clips.getByText('End').click();
  // One frame for the whole video: choosing another replaces it.
  const frames = page.getByRole('group', { name: 'Frames to export' });
  await frames.getByRole('button', { name: '9:16' }).click();
  await expect(frames.getByRole('button', { name: '9:16' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(frames.getByRole('button', { name: 'Original' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page
    .getByRole('group', { name: 'Between clips' })
    .getByRole('button', { name: 'Fade' })
    .click();
  await page.getByRole('button', { name: 'Add opening shot' }).click();
  await expect(page.getByRole('group', { name: 'Opening shot and end card' })).toContainText(
    'Brand intro · 00:02.50',
  );
  await page.getByRole('button', { name: 'Choose where to save · 3 clips joined' }).click();
  await expect.poll(async () => (await calls(page, 'render_joined')).length).toBe(1);
  const [joined] = (await calls(page, 'render_joined')) as {
    id: string;
    transition: string;
    intro: string | null;
    outro: string | null;
    requests: { title: string; shape: string }[];
  }[];
  expect(joined).toMatchObject({
    id: PROJECT,
    transition: 'fade',
    intro: 'C:/library/bookends/intro.mp4',
    outro: null,
    target: 'C:/out/joined.mp4',
  });
  // In bin order, all in the one frame.
  expect(joined.requests.map((r) => r.title)).toEqual(['Opening', 'Later', 'End']);
  expect(new Set(joined.requests.map((r) => r.shape))).toEqual(new Set(['vertical']));
  await expect(
    page.getByRole('status').filter({ hasText: 'Rendered “Opening + 2 more”' }),
  ).toBeVisible();
  // The opening shot stays with the project.
  await page.reload();
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  await page
    .getByRole('group', { name: 'Export as' })
    .getByRole('button', { name: 'One joined video' })
    .click();
  await page.getByRole('button', { name: 'Remove the opening shot' }).click();
  await expect(page.getByRole('button', { name: 'Add opening shot' })).toBeVisible();
});
