import { expect, test, type Page } from '@playwright/test';
import { openClipTools } from './clip-tools';
import { sequenceItems, sequenceLabel } from '../src/sequence';
import { CAPTION_FONTS, captionLook, cutCaptions } from '../src/captions';
import { applyLook, lookFrom } from '../src/look';
import type { Cut } from '../src/studio';

const clip = (id: string, title: string, start: number, end: number) =>
  ({ id, title, start, end, shape: 'source', fit: 'fill' }) as Cut;

test('a joined preview plays the opening shot, the chosen clips in bin order, and the end card', () => {
  const cuts = [clip('a', 'One', 0, 1), clip('b', 'Two', 2, 3), clip('c', 'Three', 4, 5)];
  const bookend = { path: 'C:/b.mp4', name: 'b.mp4', duration: 2 };
  const items = sequenceItems({ cuts, bookends: { intro: bookend, outro: bookend } }, ['c', 'a']);
  expect(items).toEqual([
    { kind: 'bookend', end: 'intro' },
    { kind: 'clip', id: 'a' },
    { kind: 'clip', id: 'c' },
    { kind: 'bookend', end: 'outro' },
  ]);
  expect(sequenceLabel({ items, at: 0 }, cuts)).toBe('Opening shot');
  expect(sequenceLabel({ items, at: 2 }, cuts)).toBe('Clip 2 of 2 · Three');
  expect(sequenceItems({ cuts }, [])).toEqual([]);
});

test('caption faces are kept on the clip, sent with the export, and carried by looks', () => {
  expect(CAPTION_FONTS.map((font) => font.value)).toEqual([
    'noto',
    'montserrat',
    'poppins',
    'bebas',
    'anton',
  ]);
  expect(cutCaptions({ captions: { font: 'bebas' } }).font).toBe('bebas');
  expect(cutCaptions({ captions: { font: 'comic' as never } }).font).toBeUndefined();
  expect(captionLook(cutCaptions({})).font).toBe('noto');
  const styled = { ...clip('a', 'One', 0, 1), captions: { font: 'anton', scale: 1.2 } } as Cut;
  const look = lookFrom(styled);
  expect(look.captions).toMatchObject({ font: 'anton', scale: 1.2 });
  const plain = applyLook(clip('b', 'Two', 0, 1), look);
  expect(cutCaptions(plain)).toMatchObject({ font: 'anton', scale: 1.2 });
  // A look without a face sets the clip back to Noto Sans.
  expect(cutCaptions(applyLook(styled, lookFrom(clip('c', 'Three', 0, 1)))).font).toBeUndefined();
});

const PROJECT = '7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e';
type Call = [string, Record<string, unknown>];

async function openDesktop(page: Page) {
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
        if (cmd === 'read_transcript')
          return {
            language: 'en',
            segments: [{ start: 0.2, end: 2, text: 'Snow on the summits.' }],
            words: [
              { start: 0.2, end: 0.6, text: 'Snow' },
              { start: 0.6, end: 0.9, text: 'on' },
              { start: 0.9, end: 1.2, text: 'the' },
              { start: 1.2, end: 2, text: 'summits.' },
            ],
          };
        if (cmd === 'pick_export_file') return 'C:/out/clip.mp4';
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
              { id: 'c1', title: 'Opening', start: 0, end: 2.4, shape: 'source', fit: 'fill' },
              { id: 'c2', title: 'Middle', start: 10, end: 11, shape: 'source', fit: 'fill' },
              { id: 'c3', title: 'Last', start: 20, end: 21, shape: 'source', fit: 'fill' },
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
}

test('play every clip in order in the monitor, as the joined video', async ({ page }) => {
  await openDesktop(page);
  await page.getByRole('button', { name: 'Play in order' }).click();
  const bar = page.locator('.sequence-bar');
  await expect(bar).toContainText('Clip 1 of 3 · Opening');
  const bin = page.getByRole('group', { name: 'Clips' });
  await expect(bin.getByRole('button', { name: /Opening/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Each clip hands over to the next at its out point.
  await expect(bar).toContainText('Clip 2 of 3 · Middle', { timeout: 15000 });
  await expect(bar).toContainText('Clip 3 of 3 · Last', { timeout: 15000 });
  await expect(bar).toHaveCount(0, { timeout: 15000 });
  await expect(bin.getByRole('button', { name: /Last/ })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.querySelector('video')!.paused)).toBe(true);
  // From the join dialog, with a fade between clips; Stop ends it.
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  await page
    .getByRole('group', { name: 'Export as' })
    .getByRole('button', { name: 'One joined video' })
    .click();
  await page
    .getByRole('group', { name: 'Between clips' })
    .getByRole('button', { name: 'Fade' })
    .click();
  await page.getByRole('group', { name: 'Clips to export' }).getByText('Opening').click();
  await page.getByRole('button', { name: 'Preview in order' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(bar).toContainText(/Clip 1 of \d · /);
  await expect(page.locator('.sequence-seam[data-transition="fade"]').first()).toBeAttached({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Stop the joined preview' }).click();
  await expect(bar).toHaveCount(0);
});

test('captions in another face, in the preview and the export', async ({ page }) => {
  await openDesktop(page);
  await page
    .getByRole('group', { name: 'Clips' })
    .getByRole('button', { name: /Opening/ })
    .click();
  await openClipTools(page, 'Captions');
  const font = page.getByRole('combobox', { name: 'Font' });
  await font.click();
  await page.getByRole('option', { name: 'Bebas Neue' }).click();
  await expect(font).toHaveAttribute('data-value', 'bebas');
  await page.evaluate(() => {
    document.querySelector('video')!.currentTime = 1;
  });
  await expect(page.locator('.caption-stage')).toHaveAttribute('style', /Quikclip Bebas/);
  // The preview loads the face itself, not a stand-in.
  await expect
    .poll(() => page.evaluate(() => document.fonts.check("700 40px 'Quikclip Bebas'")))
    .toBe(true);
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  await page.getByRole('button', { name: 'Choose destination' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __calls: Call[] }).__calls.filter(([c]) => c === 'render_clip')
            .length,
      ),
    )
    .toBe(1);
  const request = await page.evaluate(
    () =>
      (window as unknown as { __calls: Call[] }).__calls.find(([c]) => c === 'render_clip')![1]
        .request as { captions: string },
  );
  expect(JSON.parse(request.captions)).toMatchObject({ font: 'bebas' });
});
