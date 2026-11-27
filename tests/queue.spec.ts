import { expect, test, type Page } from '@playwright/test';
import { nextRender, queueSummary, type RenderTask } from '../src/renders';

const PROJECT = '4a3b2c1d-0e9f-4876-a5b4-c3d2e1f0a9b8';

test('the queue starts the first waiting render only when nothing is rendering', () => {
  const task = (id: string, status: RenderTask['status'], progress = 0) =>
    ({ id, status, progress }) as RenderTask;
  expect(nextRender([task('a', 'done'), task('b', 'queued'), task('c', 'queued')])?.id).toBe('b');
  expect(nextRender([task('a', 'running'), task('b', 'queued')])).toBeNull();
  expect(queueSummary([task('a', 'running', 0.42), task('b', 'queued')])).toBe(
    'Rendering 42% · 1 waiting',
  );
  expect(queueSummary([task('a', 'done'), task('b', 'failed')])).toBe('1 rendered · 1 failed');
});

async function openDesktop(page: Page) {
  await page.addInitScript((id) => {
    const w = window as unknown as Record<string, unknown>;
    const calls: [string, unknown][] = [];
    const pending: {
      args: { job: string };
      resolve: (v: unknown) => void;
      reject: (e: unknown) => void;
    }[] = [];
    let next = 1;
    w.__calls = calls;
    w.__pending = pending;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      transformCallback: (callback: unknown) => {
        const n = next++;
        w[`_${n}`] = callback;
        return n;
      },
      convertFileSrc: (path: string) =>
        path.endsWith('.mp4') ? '/sample/alpine.mp4' : '/sample/lake.jpg',
      invoke: (cmd: string, args: { job: string }) => {
        calls.push([cmd, args]);
        if (cmd === 'plugin:event|listen') return Promise.resolve(next++);
        if (cmd === 'pick_export_file') return Promise.resolve('C:/out/clip.mp4');
        // Renders finish when the test says so.
        if (cmd === 'render_clip')
          return new Promise((resolve, reject) => pending.push({ args, resolve, reject }));
        return Promise.resolve(null);
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
              { id: 'c2', title: 'Later', start: 14, end: 24, shape: 'source', fit: 'fill' },
            ],
            selected: 'c1',
          },
        ]),
      );
      localStorage.setItem('quikclip.1.active', JSON.stringify(id));
    }
  }, PROJECT);
  await page.goto('/');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
}

const rendersStarted = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __calls: [string][] }).__calls.filter(
        ([cmd]) => cmd === 'render_clip',
      ).length,
  );

async function queue(page: Page) {
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  await page.getByRole('button', { name: 'Choose destination' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Sends the studio a render's progress, as the desktop side's `render-progress` event. */
async function progress(page: Page, index: number, fraction: number) {
  await page.evaluate(
    ({ index, fraction }) => {
      const w = window as unknown as Record<string, unknown>;
      const job = (w.__pending as { args: { job: string } }[])[index].args.job;
      const listen = (w.__calls as [string, { event: string; handler: number }][]).find(
        ([cmd, args]) => cmd === 'plugin:event|listen' && args.event === 'render-progress',
      )!;
      (w[`_${listen[1].handler}`] as (e: unknown) => void)({
        event: 'render-progress',
        id: 1,
        payload: { job, fraction },
      });
    },
    { index, fraction },
  );
}

const settle = (page: Page, index: number, how: 'resolve' | 'reject', value: unknown) =>
  page.evaluate(
    ({ index, how, value }) => {
      const pending = (window as unknown as Record<string, unknown>).__pending as Record<
        'resolve' | 'reject',
        (v: unknown) => void
      >[];
      pending[index][how](value);
    },
    { index, how, value },
  );

test('renders wait their turn in the background while editing goes on', async ({ page }) => {
  await openDesktop(page);
  const summary = page.getByRole('button', { name: /^Render queue:/ });
  await queue(page);
  await expect(summary).toContainText('Rendering 0%');
  // The second waits for the first.
  await page.getByLabel('Clip name').fill('Opening, renamed while rendering');
  await page.getByLabel('Clip name').press('Enter');
  await page.getByRole('button', { name: 'Next clip' }).click();
  await queue(page);
  await expect(summary).toContainText('Rendering 0% · 1 waiting');
  expect(await rendersStarted(page)).toBe(1);
  await progress(page, 0, 0.5);
  await expect(summary).toContainText('Rendering 50% · 1 waiting');
  // The queued render kept the settings it was queued with.
  const first = await page.evaluate(
    () =>
      (
        (window as unknown as Record<string, unknown>).__pending as {
          args: { request: { title: string } };
        }[]
      )[0].args.request.title,
  );
  expect(first).toBe('Opening');
  // Cancel the waiting one; finish the first.
  await summary.click();
  const panel = page.getByRole('group', { name: 'Renders' });
  await panel.getByRole('button', { name: 'Cancel Later' }).click();
  await expect(panel.locator('.render-item.cancelled')).toContainText('Cancelled');
  await settle(page, 0, 'resolve', 'C:/out/clip.mp4');
  await expect(panel.locator('.render-item.done')).toContainText('Saved to C:/out/clip.mp4');
  await expect(page.getByRole('status').filter({ hasText: 'Rendered “Opening”' })).toBeVisible();
  expect(await rendersStarted(page)).toBe(1);
  // A render that fails says why.
  await page.keyboard.press('Escape');
  await queue(page);
  await expect.poll(() => rendersStarted(page)).toBe(2);
  await settle(page, 1, 'reject', 'The disk is full.');
  await summary.click();
  await expect(panel.locator('.render-item.failed')).toContainText('The disk is full.');
  await panel.getByRole('button', { name: 'Clear finished' }).click();
  await expect(summary).toHaveCount(0);
  // The finished render is in the export history.
  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  await expect(page.getByText('Opening').first()).toBeVisible();
});
