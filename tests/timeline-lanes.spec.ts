import { expect, test, type Page } from '@playwright/test';
import { clipLayers, moveLayer, stackLayers } from '../src/lanes';
import { moveItem } from '../src/studio';

test('layers stack into rows only where they overlap, and stay inside the clip when moved', () => {
  const { placed, rows } = stackLayers([
    { id: 'a', at: 0, length: 2 },
    { id: 'b', at: 1, length: 2 },
    { id: 'c', at: 2, length: 1 },
    { id: 'd', at: 0.5, length: 1 },
    { id: 'e', at: 0.6, length: 1 },
  ]);
  expect(Object.fromEntries(placed.map(({ layer, row }) => [layer.id, row]))).toEqual({
    a: 0,
    d: 1,
    e: 2, // a fourth row would be one too many, so it goes on the last
    b: 2,
    c: 0,
  });
  expect(rows).toBe(3);
  expect(stackLayers([]).rows).toBe(1);
  expect(moveLayer(-1, 2, 10)).toBe(0);
  expect(moveLayer(9.4, 2, 10)).toBe(8);
  expect(moveLayer(3.333, 2, 10)).toBe(3.35);
  expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  const video = {
    id: 'v',
    title: 'Talk',
    source: 'Local video',
    path: '',
    duration: 30,
    width: 1,
    height: 1,
    fps: 24,
    frames: [],
    wave: null,
  };
  expect(
    clipLayers(
      {
        start: 10,
        end: 14,
        texts: [
          {
            id: 't',
            text: ' Big ',
            preset: 'title',
            at: 1,
            length: 9,
            x: 0.5,
            y: 0.5,
            animation: 'none',
          },
        ],
        broll: [{ id: 'b', video: 'v', from: 0, at: 0.5, length: 1, mode: 'pip' }],
      },
      [video],
    ),
  ).toEqual([
    { id: 'b', kind: 'broll', label: 'Picture in picture · Talk', at: 0.5, length: 1 },
    { id: 't', kind: 'text', label: 'Big', at: 1, length: 3 },
  ]);
});

const PROJECT = '0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6';
async function openDesktop(page: Page) {
  await page.addInitScript((id) => {
    const w = window as unknown as Record<string, unknown>;
    let next = 1;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      transformCallback: (callback: unknown) => {
        const n = next++;
        w[`_${n}`] = callback;
        return n;
      },
      convertFileSrc: (path: string) =>
        path.endsWith('.mp4') ? '/sample/alpine.mp4' : '/sample/lake.jpg',
      invoke: async (cmd: string) => {
        if (cmd === 'plugin:event|listen') return next++;
        if (cmd === 'pick_export_file') return null;
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
              {
                id: 'c1',
                title: 'Opening',
                start: 2,
                end: 12,
                shape: 'source',
                fit: 'fill',
                texts: [
                  {
                    id: 't1',
                    text: 'Hello',
                    preset: 'title',
                    at: 1,
                    length: 2,
                    x: 0.5,
                    y: 0.3,
                    animation: 'none',
                  },
                ],
              },
              { id: 'c2', title: 'Later', start: 16, end: 24, shape: 'source', fit: 'fill' },
              { id: 'c3', title: 'End', start: 26, end: 30, shape: 'source', fit: 'fill' },
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
const saved = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('quikclip.1.projects')!)[0].cuts as {
        id: string;
        texts?: { at: number }[];
      }[],
  );

test('the timeline shows the video’s other clips and the clip’s layers, which drag to move', async ({
  page,
}) => {
  await openDesktop(page);
  const timeline = page.getByRole('region', { name: 'Timeline' });
  // The whole source shows at first.
  await expect(timeline.getByRole('button', { name: 'Show full source' })).toBeDisabled();
  // The text layer sits in the Layers lane, and moves by key and by drag.
  const layers = timeline.getByRole('group', { name: 'Layers on this clip' });
  const hello = layers.getByRole('button', { name: /Move text “Hello”, 1\.0 s into the clip/ });
  await expect(hello).toBeVisible();
  await hello.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(layers.getByRole('button', { name: /“Hello”, 2\.0 s/ })).toBeVisible();
  const box = (await layers.getByRole('button', { name: /“Hello”/ }).boundingBox())!;
  const lane = (await layers.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  // A second of the 36 s source is this many pixels.
  await page.mouse.move(box.x + 4 + (lane.width / 36) * 3, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await saved(page))[0].texts![0].at).toBeGreaterThan(4.6);
  expect((await saved(page))[0].texts![0].at).toBeLessThanOrEqual(5.4);
  // Other clips are on the video track: a tab selects one.
  await timeline.getByRole('button', { name: 'Select clip 02: Later' }).click();
  await expect(
    page.getByRole('group', { name: 'Clips' }).getByRole('button', { name: /Later/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(layers).toContainText('Text and b-roll on this clip show here');
});

test('clips reorder in the bin and in the join dialog, which joins them in that order', async ({
  page,
}) => {
  await openDesktop(page);
  const bin = page.getByRole('group', { name: 'Clips' });
  await expect(page.getByText('Drag clips, or press Alt + ↑ / ↓, to reorder them.')).toBeVisible();
  await bin.getByRole('button', { name: /Opening/ }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(async () => (await saved(page)).map((c) => c.id)).toEqual(['c2', 'c1', 'c3']);
  await expect(bin.getByRole('button', { name: /Opening/ })).toBeFocused();
  // Dragging a card onto the top half of another puts it before that one.
  const end = bin.getByRole('button', { name: /End/ });
  const later = bin.getByRole('button', { name: /Later/ });
  await end.dragTo(later, { targetPosition: { x: 20, y: 4 } });
  await expect.poll(async () => (await saved(page)).map((c) => c.id)).toEqual(['c3', 'c2', 'c1']);
  // The join dialog plays them in this order and moves them too.
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  await page
    .getByRole('group', { name: 'Export as' })
    .getByRole('button', { name: 'One joined video' })
    .click();
  const clips = page.getByRole('group', { name: 'Clips to export' });
  await expect(clips.locator('.batch-order')).toHaveText(['01', '02', '03']);
  await clips.getByRole('button', { name: 'Play Opening earlier' }).click();
  await expect(clips.locator('.batch-clip span:not(.batch-move)')).toHaveText([
    'End',
    'Opening',
    'Later',
  ]);
  await expect(clips.getByRole('button', { name: 'Play End earlier' })).toBeDisabled();
});
