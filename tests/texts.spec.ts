import { openClipTools } from './clip-tools';
import { expect, test, type Page } from '@playwright/test';
import { cutTexts, newText, textFrame, textsAt, textsRequest, type TextLayer } from '../src/texts';

test('a text layer animates in as the export draws it', () => {
  const base = { text: 'Hello', length: 2 };
  // Pop: grows past full size, then settles.
  expect(textFrame({ ...base, animation: 'pop' }, 0).scale).toBeCloseTo(0.6);
  expect(textFrame({ ...base, animation: 'pop' }, 0.18).scale).toBeCloseTo(1.08);
  expect(textFrame({ ...base, animation: 'pop' }, 0.5).scale).toBeCloseTo(1);
  // Fade: in over a quarter second, out over the last.
  expect(textFrame({ ...base, animation: 'fade' }, 0.125).opacity).toBeCloseTo(0.5);
  expect(textFrame({ ...base, animation: 'fade' }, 1.9).opacity).toBeCloseTo(0.4);
  // Slide: rises into place.
  expect(textFrame({ ...base, animation: 'slide' }, 0).lift).toBeCloseTo(0.05);
  expect(textFrame({ ...base, animation: 'slide' }, 0.3).lift).toBeCloseTo(0);
  // Type: a letter every 45 ms.
  expect(textFrame({ ...base, animation: 'type' }, 0).letters).toBe(1);
  expect(textFrame({ ...base, animation: 'type' }, 0.1).letters).toBe(3);
  expect(textFrame({ ...base, animation: 'type' }, 1).letters).toBe(5);
  const layer = newText({ start: 10, end: 14 }, 13.5);
  expect(layer).toMatchObject({ at: 3, length: 1, preset: 'title', animation: 'pop' });
  const layers: TextLayer[] = [
    layer,
    { ...layer, id: 'empty', text: '  ' },
    { ...layer, id: 'late', at: 9 },
  ];
  expect(cutTexts({ start: 10, end: 14, texts: layers }).map((item) => item.id)).toEqual([
    layer.id,
  ]);
  expect(textsAt([layer], 10, 13.5)).toEqual([{ layer, offset: 0.5 }]);
  expect(textsRequest([{ ...layer, animation: 'none', text: ' Hi ' }])[0]).toMatchObject({
    text: 'Hi',
    animation: '',
    color: '',
  });
});

async function seekTo(page: Page, time: number) {
  await page
    .locator('.stage-face video')
    .evaluate((v: HTMLVideoElement, t) => (v.currentTime = t), time);
  await expect(page.locator('.time-now')).toHaveText(`00:${String(time).padStart(2, '0')}.00`);
}

test('text layers are written, styled, placed and timed over the preview', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
  await seekTo(page, 2);
  await openClipTools(page, 'Text on video');
  await page.getByRole('button', { name: 'Add text at the playhead' }).click();
  const card = page.getByRole('group', { name: 'Text 1', exact: true });
  await expect(card.getByLabel('Shows at')).toHaveValue('00:02.00');
  const overlay = page.locator('.text-overlay');
  await expect(overlay).toHaveText('Your title');
  await card.getByLabel('Text 1 words').fill('Above the clouds');
  await card.getByLabel('Text 1 words').blur();
  await expect(overlay).toHaveText('Above the clouds');
  await card
    .getByRole('group', { name: 'Text 1 style' })
    .getByRole('button', { name: 'Call to action' })
    .click();
  await expect(overlay).toHaveClass(/boxed/);
  await card
    .getByRole('group', { name: 'Text 1 place' })
    .getByRole('button', { name: 'Bottom centre' })
    .click();
  await expect.poll(() => overlay.evaluate((el) => (el as HTMLElement).style.top)).toBe('80%');
  await card
    .getByRole('radiogroup', { name: 'Text 1 colour' })
    .getByRole('radio', { name: 'Sun' })
    .click();
  await expect(overlay).toHaveCSS('color', 'rgb(255, 209, 102)');
  // Outside its stretch, it's gone.
  await seekTo(page, 6);
  await expect(overlay).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove text 1' }).click();
  await expect(card).toHaveCount(0);
});
