import { expect, test } from '@playwright/test';
import { clipTools, openClipTools } from './clip-tools';

test('keeps the monitor and timeline in view while scrolling desktop settings', async ({
  page,
}) => {
  await page.goto('/');
  const monitor = page.getByRole('region', { name: 'Source monitor' });
  const inspector = page.getByRole('complementary', { name: 'Clip inspector' });
  const timeline = page.getByRole('region', { name: 'Timeline' });
  const screen = (await monitor.boundingBox())!;
  const side = (await inspector.boundingBox())!;
  const deck = (await timeline.boundingBox())!;
  expect(deck.x).toBeLessThan(side.x);
  expect(deck.x + deck.width).toBeCloseTo(side.x + side.width, 0);
  const gap = deck.y - (side.y + side.height);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(20);

  await openClipTools(page, 'Audio');
  await page.getByRole('button', { name: 'Cut out pauses', exact: true }).scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.locator('.inspector-clips').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(await monitor.boundingBox()).toEqual(screen);
  expect(await timeline.boundingBox()).toEqual(deck);

  await page.setViewportSize({ width: 900, height: 640 });
  await expect(monitor).toBeInViewport({ ratio: 1 });
  await expect(timeline).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Export clip', exact: true })).toBeInViewport();
});

test('long clip and caption lists and file pickers do not extend the desktop page', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => localStorage.getItem('quikclip.1.projects'));
  await page.evaluate(() => {
    const projects = JSON.parse(localStorage.getItem('quikclip.1.projects')!);
    const project = projects[0];
    const first = project.cuts[0];
    project.cuts = [
      {
        ...first,
        end: 36,
        captions: {
          from: 0,
          to: 36,
          words: Array.from({ length: 50 }, (_, i) => ({
            start: i * 0.7,
            end: i * 0.7 + 0.17,
            text: `Line ${i + 1}.`,
          })),
        },
      },
      ...Array.from({ length: 59 }, (_, i) => ({
        ...first,
        id: `extra-${i}`,
        title: `Clip ${i + 2}`,
      })),
    ];
    localStorage.setItem('quikclip.1.projects', JSON.stringify(projects));
  });
  await page.reload();

  const pageOverflow = () =>
    page.evaluate(() => {
      const root = document.scrollingElement!;
      return root.scrollHeight - root.clientHeight;
    });
  await expect(page.locator('.cut-card')).toHaveCount(60);
  expect(await pageOverflow()).toBe(0);

  await openClipTools(page, 'Captions');
  await expect(page.getByRole('list', { name: 'Caption lines' }).getByRole('listitem')).toHaveCount(
    50,
  );
  expect(await pageOverflow()).toBe(0);

  await openClipTools(page, 'Headline and logo');
  await openClipTools(page, 'Audio');
  await page
    .getByRole('checkbox', { name: 'I own this audio or have permission to use it.' })
    .check();
  await expect(page.getByLabel('Logo file')).toBeAttached();
  await expect(page.getByLabel('Music file')).toBeAttached();
  expect(await pageOverflow()).toBe(0);
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeInViewport({ ratio: 1 });
});

test('scrubs the source and trims without moving the range when a handle is grabbed', async ({
  page,
}) => {
  await page.goto('/');
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((el) => el.readyState)).toBeGreaterThan(0);
  const tracks = page.locator('.tracks');
  const strip = (await page.locator('.filmstrip').boundingBox())!;
  await tracks.click({ position: { x: Math.round(strip.width / 2), y: 40 } });
  await expect.poll(() => video.evaluate((el) => el.currentTime)).toBeCloseTo(18, 0);

  const out = page.getByRole('button', { name: 'Drag clip end' });
  const edge = (await out.boundingBox())!;
  const x = edge.x + edge.width / 2;
  const y = edge.y + edge.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(page.getByLabel('Out point', { exact: true })).toHaveValue('00:12.00');
  await page.mouse.move(x + strip.width / 12, y, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const value = await page.getByLabel('Out point', { exact: true }).inputValue();
      return Number(value.split(':')[1]);
    })
    .toBeCloseTo(15, 0);

  await page.getByRole('button', { name: 'Drag clip start' }).press('ArrowRight');
  await expect(page.getByLabel('In point', { exact: true })).toHaveValue('00:00.10');
});

test('inspector tabs support keyboard navigation without scrubbing the video', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.locator('video').evaluate((el) => el.readyState)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Jump to clip end' }).click();
  const clips = page.getByRole('tab', { name: 'Clips', exact: true });
  const transcript = page.getByRole('tab', { name: 'Transcript', exact: true });
  await clips.press('ArrowRight');
  await expect(transcript).toBeFocused();
  await expect(transcript).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Transcript' })).toBeVisible();
  await expect(page.locator('.time-now')).toHaveText('00:12.00');
  await transcript.press('Home');
  await expect(clips).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Clips' })).toBeVisible();
});

test('selected controls stay visible in high contrast and dialogs respect reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.goto('/');
  const clips = page.getByRole('tab', { name: 'Clips', exact: true });
  await expect(clips).toHaveCSS('outline-style', 'solid');
  await page.getByRole('button', { name: 'Import media', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import media' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('animation-name', 'none');
});

test('advanced clip tools expand from the keyboard and stay open when returning from the transcript', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('In point', { exact: true })).toBeVisible();
  const pauses = page.getByRole('button', { name: 'Cut out pauses', exact: true });
  await expect(pauses).toBeHidden();
  await clipTools(page, 'Audio').press('Space');
  await expect(pauses).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
  await page.getByRole('tab', { name: 'Clips', exact: true }).click();
  await expect(pauses).toBeVisible();
});

test('clip tool hit targets follow their rounded rows', async ({ page }) => {
  await page.goto('/');
  for (const title of ['Captions', 'Headline and logo', 'Audio']) {
    const summary = clipTools(page, title);
    await summary.scrollIntoViewIfNeeded();
    const hits = await summary.evaluate((row) => {
      const { left, top, right, bottom, width, height } = row.getBoundingClientRect();
      return [
        [left + 1, top + 1],
        [right - 1, bottom - 1],
        [left + width / 2, top + height / 2],
      ].map(([x, y]) => document.elementFromPoint(x, y)?.closest('summary') === row);
    });
    expect(hits).toEqual([false, false, true]);
  }
});

test('the phone layout keeps workspace navigation and actions reachable without horizontal scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Alpine field notes' })).toBeVisible();

  const choices = page.getByRole('group', { name: 'Output frame' });
  await choices.getByRole('button', { name: '9:16', exact: true }).click();
  await expect(choices.getByRole('button', { name: '9:16', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(page.getByRole('button', { name: 'Export clip', exact: true })).toBeInViewport();

  await page.getByRole('button', { name: 'Media library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Media library' })).toBeInViewport();
  await page.getByRole('button', { name: 'Add a source', exact: false }).click();
  const dialog = page.getByRole('dialog', { name: 'Import media' });
  await dialog.getByRole('button', { name: 'Video link' }).click();
  await expect(dialog.getByRole('button', { name: 'Video link' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByLabel('Video link')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No exports yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Open clip editor' }).click();
  await expect(page.getByRole('heading', { name: 'Alpine field notes' })).toBeInViewport();
});
