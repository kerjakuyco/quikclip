import { expect, test } from '@playwright/test';
import { fitClip, trimTime, trimToWord, wordEdges, zoomView } from '../src/timeline';
import { clipTool, openClipTools } from './clip-tools';

test('bounds timeline zoom and preserves fractional frame timestamps', () => {
  expect(zoomView({ start: 8, span: 20 }, 36, 0.5, 13)).toEqual({ start: 10.5, span: 10 });
  expect(zoomView({ start: 26, span: 10 }, 36, 0.001, 36)).toEqual({ start: 35, span: 1 });
  expect(fitClip(0, 0.25, 0.25)).toEqual({ start: 0, span: 0.25 });
  const fps = 30_000 / 1001;
  expect(trimTime(0.1, 0, 1, fps)).toBe(3 / fps);
  expect(trimTime(0.1, 0, 0.08, fps)).toBe(2 / fps);
  expect(trimTime(0.12345, 0, 1, 0)).toBe(0.123);
});

test('finds legal word boundaries without snapping across quiet gaps', () => {
  const edges = wordEdges([
    { start: 10.01, end: 10.2 },
    { start: 1.234, end: 1.41 },
    { start: 1.7, end: 2.2 },
    { start: NaN, end: 9 },
  ]);
  expect(trimToWord(edges.start, 1.2, 0, 12)).toBe(1.234);
  expect(trimToWord(edges.end, 2.1, 0, 12)).toBe(2.2);
  expect(trimToWord(edges.start, 1.62, 0, 1.65)).toBe(1.234);
  expect(trimToWord(edges.start, 5.1, 0, 12)).toBe(5.1);
  expect(trimToWord(edges.start, 1.234, 0, 12, 1)).toBe(1.7);
  expect(trimToWord(edges.end, 2.2, 0, 12, -1)).toBe(1.41);
});

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
  await expect(page.getByLabel('Logo file')).toBeAttached();
  expect(await pageOverflow()).toBe(0);
  await openClipTools(page, 'Audio');
  await page
    .getByRole('checkbox', { name: 'I own this audio or have permission to use it.' })
    .check();
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

test('zooms and pans the same source-time window for the ruler, media tracks, and trims', async ({
  page,
}) => {
  await page.goto('/');
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((el) => el.readyState)).toBeGreaterThan(0);
  const timeline = page.getByRole('region', { name: 'Timeline' });
  const pan = timeline.getByRole('slider', { name: 'Pan timeline' });
  const tracks = timeline.locator('.tracks');
  await page
    .getByRole('group', { name: 'Clips' })
    .getByRole('button', { name: /Into the valley/ })
    .click();
  await timeline.getByRole('button', { name: 'Fit clip' }).click();
  await expect(pan).toHaveAttribute('aria-valuetext', '00:10.80 to 00:25.20');
  const waveform = timeline.getByRole('img', { name: 'Source audio waveform' });
  const viewBox = async () => (await waveform.getAttribute('viewBox'))!.split(' ').map(Number);
  const [at, , span] = await viewBox();
  expect(at).toBeCloseTo(300, 3);
  expect(span).toBeCloseTo(400, 3);
  const tick = timeline.locator('.ruler-mark', { hasText: /^00:14$/ });
  expect(await tick.evaluate((el) => parseFloat((el as HTMLElement).style.left))).toBeCloseTo(
    ((14 - 10.8) / 14.4) * 100,
    2,
  );
  await expect(timeline.locator('.filmstrip > div').first()).toHaveCSS(
    'background-image',
    /ridge\.jpg/,
  );

  const strip = (await tracks.boundingBox())!;
  const out = (await timeline.getByRole('button', { name: 'Drag clip end' }).boundingBox())!;
  await page.mouse.move(out.x + out.width / 2, out.y + out.height / 2);
  await page.mouse.down();
  await page.mouse.move(out.x + out.width / 2 - (strip.width * 1.5) / 14.4, out.y + out.height / 2);
  await page.mouse.up();
  const outPoint = await page.getByLabel('Out point', { exact: true }).inputValue();
  expect(Number(outPoint.split(':')[1])).toBeCloseTo(22.5, 1);

  await tracks.click({ position: { x: strip.width / 2, y: 40 } });
  await expect.poll(() => video.evaluate((el) => el.currentTime)).toBeCloseTo(18, 1);
  await timeline.getByRole('button', { name: 'Zoom timeline in' }).click();
  await expect(timeline.getByRole('button', { name: 'Drag clip start' })).toHaveCount(0);
  await expect(timeline.getByRole('button', { name: 'Drag clip end' })).toHaveCount(0);
  await expect(pan).toBeEnabled();
  await pan.press('Home');
  const rail = (await pan.boundingBox())!;
  const railY = rail.y + rail.height / 2;
  await page.mouse.move(rail.x + rail.width / 10, railY);
  await page.mouse.down();
  await page.mouse.move(rail.x + rail.width / 2, railY);
  await page.mouse.up();
  expect(Number(await pan.inputValue())).toBeCloseTo(14.4, 1);
  await pan.press('End');
  await expect(pan).toHaveAttribute('aria-valuetext', '00:28.80 to 00:36.00');
  expect((await viewBox())[0]).toBeCloseTo(800, 3);
  await expect(timeline.locator('.filmstrip > div').first()).toHaveCSS(
    'background-image',
    /lake\.jpg/,
  );
  await expect(timeline.locator('.playhead')).toHaveCount(0);
  expect(await video.evaluate((el) => el.currentTime)).toBeCloseTo(18, 1);
  await tracks.click({ position: { x: strip.width / 2, y: 40 } });
  await expect.poll(() => video.evaluate((el) => el.currentTime)).toBeCloseTo(32.4, 1);

  await timeline.getByRole('button', { name: 'Show full source' }).click();
  await expect(pan).toBeDisabled();
  await expect(pan).toHaveAttribute('aria-valuetext', '00:00.00 to 00:36.00');
  await expect(timeline.getByRole('button', { name: 'Drag clip start' })).toBeVisible();
});

test('fits a quarter-second cut at the end of a 12-hour timeline without overflowing', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const cut = { id: 'cut', title: 'Last moment', start: 43199.75, end: 43200, shape: 'source' };
    localStorage.setItem(
      'quikclip.1.projects',
      JSON.stringify([
        {
          id: 'sample',
          source: 'Sample',
          title: 'Long recording',
          path: '/sample/alpine.mp4',
          duration: 43200,
          width: 1280,
          height: 640,
          fps: 24,
          wave: '/sample/wave.png',
          frames: ['/sample/lake.jpg'],
          cuts: [cut],
          selected: cut.id,
        },
      ]),
    );
  });
  // Exercise the track geometry without trying to seek a short fixture to a synthetic timestamp.
  await page.route('**/sample/alpine.mp4', (route) => route.abort());
  await page.goto('/');
  const timeline = page.getByRole('region', { name: 'Timeline' });
  const pan = timeline.getByRole('slider', { name: 'Pan timeline' });
  await timeline.getByRole('button', { name: 'Fit clip' }).click();
  await expect(pan).toHaveAttribute('aria-valuetext', '719:59.00 to 720:00.00');
  await expect(timeline.getByRole('button', { name: 'Drag clip end' })).toBeInViewport({
    ratio: 1,
  });
  await expect(timeline.getByRole('button', { name: 'Zoom timeline in' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  const track = timeline.locator('.tracks');
  const { width } = (await track.boundingBox())!;
  await track.click({ position: { x: width / 2, y: 39 } });
  await expect(page.locator('.time-now')).toHaveText(/719:59\.(49|50)/);

  await pan.press('Home');
  await expect(pan).toHaveAttribute('aria-valuetext', '00:00.00 to 00:01.00');
  await expect(timeline.getByRole('button', { name: 'Drag clip end' })).toHaveCount(0);
});

test('frame snapping is optional and exact time fields stay unsnapped', async ({ page }) => {
  await page.goto('/');
  const snap = page.getByRole('combobox', { name: 'Trim snapping' });
  const start = page.getByRole('button', { name: 'Drag clip start' });
  const input = page.getByLabel('In point', { exact: true });
  await expect(snap).toHaveAttribute('data-value', 'off');
  await snap.click();
  await expect(page.getByRole('option', { name: 'Words' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.getByRole('option', { name: 'Frames' }).click();
  await start.press('ArrowRight');
  await expect(input).toHaveValue('00:00.042');
  await page.reload();
  await expect(snap).toHaveAttribute('data-value', 'frames');
  await expect(input).toHaveValue('00:00.042');
  await expect.poll(() => page.locator('video').evaluate((el) => el.readyState)).toBeGreaterThan(0);
  await input.fill('0.123');
  await input.press('Enter');
  await expect(input).toHaveValue('00:00.123');
  await page.keyboard.press('i');
  await expect(input).toHaveValue('00:00.125');
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

test('clip settings are tabs, from the keyboard too, and stay where you left them', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('In point', { exact: true })).toBeVisible();
  const pauses = page.getByRole('button', { name: 'Cut out pauses', exact: true });
  const frame = clipTool(page, 'Frame');
  await expect(frame).toHaveAttribute('aria-selected', 'true');
  await expect(pauses).toBeHidden();
  // Arrow keys move along the tabs and show each one.
  await frame.focus();
  await page.keyboard.press('ArrowRight');
  await expect(clipTool(page, 'Text')).toBeFocused();
  await expect(clipTool(page, 'Text')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(pauses).toBeVisible();
  await page.keyboard.press('End');
  await expect(clipTool(page, 'Post')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(frame).toHaveAttribute('aria-selected', 'true');
  await openClipTools(page, 'Audio');
  await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
  await page.getByRole('tab', { name: 'Clips', exact: true }).click();
  await expect(pauses).toBeVisible();
});

test('the clip settings tabs stay in view while their settings scroll', async ({ page }) => {
  await page.goto('/');
  await openClipTools(page, 'Text');
  const tabs = page.getByRole('tablist', { name: 'Clip settings' });
  const list = page.locator('.inspector-clips');
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const box = (await tabs.boundingBox())!;
  const view = (await list.boundingBox())!;
  // Stuck a step (12 px) below the panel's own tabs.
  expect(box.y).toBeGreaterThanOrEqual(view.y + 11);
  expect(box.y).toBeLessThan(view.y + 16);
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
  await page.getByRole('button', { name: 'Fit clip' }).click();
  await expect(page.getByRole('slider', { name: 'Pan timeline' })).toBeEnabled();
  await expect(page.getByRole('slider', { name: 'Horizontal crop position' })).toBeVisible();
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

test('the clip list folds away, and clips can be stepped through from the settings', async ({
  page,
}) => {
  await page.goto('/');
  const fold = page.getByRole('button', { name: 'Hide the clip list' });
  await fold.click();
  await expect(page.locator('.cut-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show the clip list' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  // Still folded after a reload.
  await page.reload();
  await expect(page.locator('.cut-card')).toHaveCount(0);
  const name = page.getByLabel('Clip name');
  await expect(name).toHaveValue('Above the clouds');
  await expect(page.getByRole('button', { name: 'Previous clip' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next clip' }).click();
  await expect(name).toHaveValue('Into the valley');
  await expect(page.getByRole('group', { name: 'Choose a clip' })).toContainText('2 / 3');
  await page.getByRole('button', { name: 'Next clip' }).click();
  await expect(page.getByRole('button', { name: 'Next clip' })).toBeDisabled();
  await page.getByRole('button', { name: 'Show the clip list' }).click();
  await expect(page.locator('.cut-card')).toHaveCount(3);
});

test('dropdowns are the studio’s own, and work from the keyboard', async ({ page }) => {
  await page.goto('/');
  const snap = page.getByRole('combobox', { name: 'Trim snapping' });
  await expect(snap).toHaveAttribute('aria-expanded', 'false');
  await snap.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('listbox', { name: 'Trim snapping' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveClass(/select-menu/);
  await expect(page.getByRole('option', { name: 'Off' })).toHaveAttribute('aria-selected', 'true');
  // Down to Frames; Words has no transcript to snap to, so it is passed over.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(snap).toHaveAttribute(
    'aria-activedescendant',
    (await page.getByRole('option', { name: 'Frames' }).getAttribute('id'))!,
  );
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(snap).toHaveAttribute('data-value', 'frames');
  await expect(snap).toBeFocused();
  // Typing a name jumps to it; Escape closes without choosing.
  await page.keyboard.press('Enter');
  await page.keyboard.type('o');
  await expect(snap).toHaveAttribute(
    'aria-activedescendant',
    (await page.getByRole('option', { name: 'Off' }).getAttribute('id'))!,
  );
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(snap).toHaveAttribute('data-value', 'frames');
  // A click elsewhere closes it too.
  await snap.click();
  await expect(menu).toBeVisible();
  await page.locator('#timeline-title').click();
  await expect(menu).toHaveCount(0);
});
