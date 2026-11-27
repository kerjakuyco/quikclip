import { openClipTools } from './clip-tools';
import { expect, test, type Page } from '@playwright/test';
import { brollAt, brollRequest, cutBroll, newShot, type BRoll } from '../src/broll';
import type { Video } from '../src/studio';

const video = (id: string, duration: number) => ({ id, title: id, duration }) as Video;

test('shots start at the playhead, prefer other footage, and stay inside the clip', () => {
  const clip = { start: 10, end: 20 };
  const own = video('a', 60);
  const other = video('b', 2);
  // Another video: from its start, no longer than it is.
  expect(newShot(clip, 'a', [own, other], 14)).toMatchObject({
    video: 'b',
    from: 0,
    at: 4,
    length: 2,
  });
  // Only this video: a later moment of it.
  expect(newShot(clip, 'a', [own], 19.5)).toMatchObject({ video: 'a', from: 21, at: 9, length: 1 });
  const shots: BRoll[] = [
    { id: '1', video: 'a', from: 30, at: 2, length: 3, mode: 'cutaway' },
    { id: '2', video: 'gone', from: 0, at: 1, length: 3, mode: 'pip' },
    { id: '3', video: 'b', from: 0, at: 12, length: 3, mode: 'pip' },
  ];
  expect(cutBroll({ ...clip, broll: shots }, [own, other]).map((shot) => shot.id)).toEqual(['1']);
  expect(brollAt(shots.slice(0, 1), 10, 13)).toEqual([{ shot: shots[0], offset: 1 }]);
  expect(brollAt(shots.slice(0, 1), 10, 15.5)).toEqual([]);
  expect(brollRequest(shots.slice(0, 1))).toEqual([
    { video: 'a', from: 30, at: 2, length: 3, mode: 'cutaway', corner: 'top-right' },
  ]);
});

async function seekTo(page: Page, time: number) {
  await page
    .locator('.stage-face video')
    .evaluate((v: HTMLVideoElement, t) => (v.currentTime = t), time);
  await expect
    .poll(() => page.locator('.stage-face video').evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(time, 1);
  // The playhead moves once the seek lands.
  await expect(page.locator('.time-now')).toHaveText(
    `00:${String(Math.floor(time)).padStart(2, '0')}.${String(Math.round((time % 1) * 100)).padStart(2, '0')}`,
  );
}

test('b-roll shows over its stretch of the preview, filling the frame or in a corner', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
  await seekTo(page, 4);
  await openClipTools(page, 'B-roll');
  await page.getByRole('button', { name: 'Add b-roll at the playhead' }).click();
  const shot = page.getByRole('group', { name: 'B-roll 1' });
  await expect(shot.getByLabel('Shows at')).toHaveValue('00:04.00');
  await expect(shot.getByLabel('For')).toHaveValue('00:03.00');
  await expect(shot.getByLabel('From')).toHaveValue('00:13.00');
  await expect(page.locator('.broll-layer video.broll-cutaway')).toBeVisible();
  // Outside its stretch, the clip plays alone.
  await seekTo(page, 8);
  await expect(page.locator('.broll-layer')).toHaveCount(0);
  await seekTo(page, 5);
  await shot.getByRole('button', { name: 'In a corner' }).click();
  await shot
    .getByRole('group', { name: 'B-roll 1 corner' })
    .getByRole('button', { name: 'Bottom left' })
    .click();
  await expect(page.locator('.broll-layer video')).toHaveClass(/broll-pip broll-bottom-left/);
  // The shot follows the clip's clock: a second in, it is a second into its own footage.
  await expect
    .poll(() => page.locator('.broll-layer video').evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(14, 0);
  await shot.getByLabel('Shows at').fill('6');
  await shot.getByLabel('Shows at').press('Enter');
  await expect(page.locator('.broll-layer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove b-roll 1' }).click();
  await expect(shot).toHaveCount(0);
});
