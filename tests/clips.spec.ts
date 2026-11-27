import { expect, test } from '@playwright/test';
import { clipLengthBand, clipMatches, lengthSpot, rulerSpot } from '../src/clips';
import { exportJobs, MAX_EXPORT_FILES } from '../src/export-plan';
import { safeInsets } from '../src/safe-areas';

const clip = (title: string, start: number, end: number, reason?: string) => ({
  title,
  start,
  end,
  highlight: reason ? { reason } : undefined,
});

test('clip search matches names, notes, speech, and length', () => {
  const spoken = [
    { start: 1, end: 2, text: 'ridge' },
    { start: 13, end: 14, text: 'valley' },
  ];
  const cuts = [
    clip('Above the clouds', 0, 12),
    clip('Into the valley', 12, 24, 'A quiet payoff'),
    clip('Long walk', 24, 90),
  ];
  expect(
    cuts.filter((item) => clipMatches(item, 'valley', 'any', spoken)).map((item) => item.title),
  ).toEqual(['Into the valley']);
  expect(cuts.filter((item) => clipMatches(item, 'quiet ridge', 'any', spoken))).toEqual([]);
  expect(
    cuts.filter((item) => clipMatches(item, 'payoff', 'any', spoken)).map((item) => item.title),
  ).toEqual(['Into the valley']);
  expect(
    cuts.filter((item) => clipMatches(item, '', 'short', spoken)).map((item) => item.title),
  ).toEqual(['Above the clouds', 'Into the valley']);
  expect(clipLengthBand(12)).toBe('short');
  expect(clipLengthBand(30)).toBe('medium');
  expect(clipLengthBand(60)).toBe('medium');
  expect(clipLengthBand(61)).toBe('long');
});

test('the length ruler places each clip inside its band and on the whole ruler', () => {
  expect(lengthSpot(15)).toBe(0.5);
  expect(lengthSpot(30)).toBe(0);
  expect(lengthSpot(60)).toBe(1);
  // The open-ended band runs to the longest clip, and to at least two minutes.
  expect(lengthSpot(90, 90)).toBe(0.5);
  expect(lengthSpot(90, 300)).toBe(0.125);
  expect(lengthSpot(400, 300)).toBe(1);
  expect(rulerSpot(15)).toBeCloseTo(1 / 6, 5);
  expect(rulerSpot(45)).toBeCloseTo(0.5, 5);
  expect(rulerSpot(90, 120)).toBeCloseTo(5 / 6, 5);
});

test('batch export keeps clip order and frame order, capped at 16 in the studio', () => {
  expect(MAX_EXPORT_FILES).toBe(16);
  expect(exportJobs([{ id: 'a' }, { id: 'b' }], ['b', 'a'], ['square', 'vertical'])).toEqual([
    { id: 'a', shape: 'vertical' },
    { id: 'a', shape: 'square' },
    { id: 'b', shape: 'vertical' },
    { id: 'b', shape: 'square' },
  ]);
});

test('safe areas follow the shaped frame and leave the original clear', () => {
  expect(safeInsets('source')).toBeNull();
  const vertical = safeInsets('vertical');
  expect(vertical?.label).toBe('TikTok, Reels, Shorts');
  expect(vertical?.top).toBeCloseTo(150 / 1920);
  expect(vertical?.right).toBeGreaterThan(vertical?.left ?? 1);
  expect(safeInsets('landscape')?.label).toBe('YouTube');
});

test('filters the clip bin and shows safe areas on a vertical frame', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Alpine field notes' })).toBeVisible();
  await page.getByLabel('Search clips').fill('valley');
  await expect(
    page.getByRole('group', { name: 'Clips' }).getByRole('button', { name: /Into the valley/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Clips' }).getByRole('button', { name: /Still waters/ }),
  ).toHaveCount(0);
  await expect(page.locator('.count')).toHaveText('1 of 3');
  // The bands count what the search leaves.
  const lengths = page.getByRole('group', { name: 'Clip length' });
  await expect(lengths.getByRole('button', { name: /^Any length, 1 clip$/ })).toBeVisible();
  await lengths.getByRole('button', { name: /^Over 60 s/ }).click();
  await expect(page.getByText('No clips match this search.')).toBeVisible();
  await lengths.getByRole('button', { name: /^Any length/ }).click();
  await page.getByLabel('Search clips').fill('');
  await expect(lengths.getByRole('button', { name: /^Any length, 3 clips$/ })).toBeVisible();
  // Choosing the band that is on turns it off; an empty band says so and offers the way back.
  const short = lengths.getByRole('button', { name: /^Under 30 s/ });
  await short.click();
  await expect(short).toHaveAttribute('aria-pressed', 'true');
  await short.click();
  await expect(lengths.getByRole('button', { name: /^Any length/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await lengths.getByRole('button', { name: /^Over 60 s, 0 clips$/ }).click();
  await expect(page.getByText('No clips over 60 seconds.')).toBeVisible();
  await page.getByRole('button', { name: 'Show every length' }).click();
  await expect(page.locator('.cut-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Safe areas', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '9:16', exact: true }).click();
  await page.getByRole('button', { name: 'Safe areas', exact: true }).click();
  await expect(page.locator('.safe-frame')).toContainText('TikTok, Reels, Shorts');
});
