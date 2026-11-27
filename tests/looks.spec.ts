import { expect, test } from '@playwright/test';
import { applyLook, BUILT_IN_LOOKS, freshName, lookFrom, matchingLook } from '../src/look';
import type { Cut } from '../src/studio';

const plain: Cut = { id: 'a', title: 'A', start: 0, end: 10, shape: 'source', fit: 'fill' };

test('a look sets the frame, captions and polish, and keeps the clip its own words', () => {
  const podcast = BUILT_IN_LOOKS.find((item) => item.id === 'clean-podcast')!;
  const words = [{ start: 1, end: 2, text: 'hello' }];
  const styled = applyLook(
    { ...plain, captions: { words, from: 0, to: 10 } as Cut['captions'] },
    podcast.look,
  );
  expect(styled).toMatchObject({
    shape: 'vertical',
    fit: 'split',
    framing: 'speaker',
    fillers: true,
    loudness: 'standard',
    captions: { style: 'clean', words },
  });
  expect(matchingLook(styled, BUILT_IN_LOOKS)?.id).toBe('clean-podcast');
  expect(matchingLook(plain, BUILT_IN_LOOKS)).toBeNull();
  // A split look on a frame that isn't tall falls back to filling it.
  expect(applyLook(plain, { ...podcast.look, shape: 'square' }).fit).toBe('fill');
  expect(lookFrom(applyLook(plain, podcast.look))).toEqual(podcast.look);
  expect(freshName('Bold creator', BUILT_IN_LOOKS)).toBe('Bold creator 2');
  expect(freshName('  ', [])).toBe('My look');
});

test('looks apply in one press, save, come back after a reload, and set new clips', async ({
  page,
}) => {
  await page.goto('/');
  const frame = page.getByRole('group', { name: 'Output frame' });
  const fit = page.getByRole('group', { name: 'Frame fit' });
  const looks = page.getByRole('group', { name: 'Look', exact: true });
  // The picker shows the clip's look and opens to the rest.
  const picker = looks.getByRole('button', { name: /^Looks,/ });
  const chips = looks.locator('.look-chips');
  await expect(picker).toHaveAccessibleName('Looks, Custom');
  await picker.click();
  await chips.getByRole('button', { name: /Quote card/ }).click();
  await expect(picker).toHaveAccessibleName('Looks, Quote card');
  await expect(chips.getByRole('button', { name: /Quote card/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(frame.getByRole('button', { name: '1:1' })).toHaveAttribute('aria-pressed', 'true');
  await expect(fit.getByRole('button', { name: 'Show the whole video' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Change it and save it as your own.
  await frame.getByRole('button', { name: '4:5' }).click();
  await expect(chips.getByRole('button', { name: /Quote card/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await looks.getByRole('button', { name: 'Save this look' }).click();
  await looks.getByLabel('Look name').fill('Feed card');
  await looks.getByRole('button', { name: 'Save', exact: true }).click();
  const mine = chips.getByRole('button', { name: /^Feed card/ });
  await expect(mine).toHaveAttribute('aria-pressed', 'true');
  // Another look, then back to yours.
  await chips.getByRole('button', { name: /Karaoke pop/ }).click();
  await expect(frame.getByRole('button', { name: '9:16' })).toHaveAttribute('aria-pressed', 'true');
  await mine.click();
  await expect(frame.getByRole('button', { name: '4:5' })).toHaveAttribute('aria-pressed', 'true');
  // It is the default for new clips, by name.
  await page.getByRole('button', { name: 'Use for new clips' }).click();
  await expect(page.locator('.look-row')).toContainText(
    'New clips start with the look “Feed card”.',
  );
  await page.reload();
  await picker.click();
  await expect(chips.getByRole('button', { name: /^Feed card/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add clip' }).click();
  await expect(frame.getByRole('button', { name: '4:5' })).toHaveAttribute('aria-pressed', 'true');
  await looks.getByRole('button', { name: 'Remove the look Feed card' }).click();
  await expect(chips.getByRole('button', { name: /^Feed card/ })).toHaveCount(0);
  await page.reload();
  await picker.click();
  await expect(chips.getByRole('button', { name: /^Feed card/ })).toHaveCount(0);
});
