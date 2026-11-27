import { expect, test, type Page } from '@playwright/test';

const PROJECT = '8c9d0e1f-2a3b-4c4d-9e5f-6a7b8c9d0e1f';
const STEP = {
  steps: ['Download', 'Editing copy', 'Preview frames'],
  index: 0,
  label: 'Downloading',
  fraction: 0.42,
  detail: '12.6 MB of 30 MB · 2.1 MB/s',
  about: 'Metro: The Documentary',
};

/** Sends the studio a desktop event, as the Rust side emits it. */
async function emit(page: Page, event: string, payload: unknown) {
  await page.evaluate(
    ({ event, payload }) => {
      const w = window as unknown as Record<string, unknown>;
      const listen = (w.__calls as [string, { event: string; handler: number }][]).findLast(
        ([cmd, args]) => cmd === 'plugin:event|listen' && args.event === event,
      )!;
      (w[`_${listen[1].handler}`] as (e: unknown) => void)({ event, id: 1, payload });
    },
    { event, payload },
  );
}

test('a job running when the window opens shows in the status bar, can be cancelled, and its import is kept', async ({
  page,
}) => {
  await page.addInitScript(
    ({ id, step }) => {
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
          if (cmd === 'current_job')
            return {
              title: 'Downloading and preparing a video…',
              started: Date.now() - 65000,
              step,
            };
          if (cmd === 'take_kept_import')
            return {
              id: '9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a',
              title: 'Metro: The Documentary',
              source: 'YouTube',
              path: 'C:/media/metro/source.mp4',
              duration: 3787,
              width: 1920,
              height: 1080,
              fps: 60,
              frames: ['C:/media/metro/frame-0.jpg'],
              wave: null,
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
                { id: 'c1', title: 'Opening', start: 0, end: 6, shape: 'source', fit: 'fill' },
              ],
              selected: 'c1',
            },
          ]),
        );
        localStorage.setItem('quikclip.1.active', JSON.stringify(id));
      }
    },
    { id: PROJECT, step: STEP },
  );
  await page.goto('/');
  // The download that was running before the window opened is in the status bar.
  const chip = page.getByRole('button', { name: 'Running: Downloading 42%' });
  await expect(chip).toBeVisible();
  await emit(page, 'studio-step', { ...STEP, fraction: 0.6 });
  await expect(page.getByRole('button', { name: 'Running: Downloading 60%' })).toBeVisible();
  await page.getByRole('button', { name: 'Running: Downloading 60%' }).click();
  const panel = page.getByRole('group', { name: 'Running job' });
  await expect(panel).toContainText('Downloading and preparing a video');
  await expect(panel.getByRole('list', { name: 'Steps' })).toContainText('Editing copy');
  await expect(panel).toContainText('12.6 MB of 30 MB');
  await page.keyboard.press('Escape');
  // Importing says why it has to wait, and offers to cancel the job.
  await page.getByRole('button', { name: 'Import media' }).click();
  const notice = page.getByRole('dialog').locator('.job-notice');
  await expect(notice).toContainText('Another job is running: Downloading 60%.');
  await notice.getByRole('button', { name: 'Cancel it' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __calls: [string][] }).__calls.filter(
            ([cmd]) => cmd === 'cancel_job',
          ).length,
      ),
    )
    .toBe(1);
  // It finished anyway, before the cancel landed: the import becomes a project.
  await emit(page, 'job-done', {
    title: 'Downloading and preparing a video…',
    error: null,
    kept: true,
  });
  await expect(page.getByText('“Metro: The Documentary” finished importing.')).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(page.locator('.background-job')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Metro: The Documentary/ }).first()).toBeVisible();
});
