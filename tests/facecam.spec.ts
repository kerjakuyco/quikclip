import { expect, test } from '@playwright/test';
import { openClipTools } from './clip-tools';
import { bandAspect, camAt, camCorner, camFromFaces, cutCam } from '../src/facecam';
import { cropBox, gameBox } from '../src/studio';

test('the facecam box keeps the band’s shape, and the gameplay matches the export’s', () => {
  // 9:16 from 1280 × 640 is 360 × 640: a 268 px band, 372 px of gameplay.
  expect(bandAspect('vertical', 1280, 640)).toBeCloseTo(360 / 268, 5);
  const corner = camAt('bottom-right', 0.25, 'vertical', 1280, 640);
  expect(corner).toEqual({ x: 0.75, y: 0.628, w: 0.25, h: 0.372 });
  expect(camCorner(corner)).toBe('bottom-right');
  // Too tall for a very wide picture: it shrinks to fit its height.
  expect(camAt('top-left', 0.6, 'vertical', 1920, 400).h).toBe(1);
  expect(cutCam({ shape: 'vertical', cam: { x: 0.9, y: 0, w: 0.3, h: 0.3 } }, 1280, 640)).toEqual(
    camAt('top-left', 0.26, 'vertical', 1280, 640),
  );
  // media.rs stack_filter cuts 618 × 640 for the gameplay.
  expect(gameBox('vertical', 1280, 640)).toEqual({ width: 618, height: 640 });
  expect(cropBox({ shape: 'vertical', fit: 'stack' }, 1280, 640)).toEqual({
    width: 618,
    height: 640,
  });
  // Around the face found most: head and shoulders, inside the picture.
  const faces = {
    start: 0,
    end: 4,
    samples: [0, 1, 2, 3].map((time) => ({
      time,
      faces: [
        { x: 0.8, y: 0.1, w: 0.08, h: 0.16 },
        { x: 0.1, y: 0.5, w: 0.02, h: 0.04 },
      ],
    })),
  };
  const around = camFromFaces({ shape: 'vertical', faces, start: 0, end: 4 }, 1280, 640)!;
  expect(around.w).toBeCloseTo(0.24, 5);
  expect(around.x + around.w).toBeLessThanOrEqual(1);
  expect(around.x).toBeLessThan(0.84);
  expect(around.x + around.w).toBeGreaterThan(0.84);
  expect(camFromFaces({ shape: 'vertical', start: 0, end: 4 }, 1280, 640)).toBeNull();
});

const PROJECT = '5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c';
type Call = [string, Record<string, unknown>];

test('a stream clip puts the facecam on top and exports it', async ({ page }) => {
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
        if (cmd === 'pick_export_file') return 'C:/out/stream.mp4';
        if (cmd === 'render_clip') return 'C:/out/stream.mp4';
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
            title: 'Stream',
            source: 'Twitch',
            path: 'C:/media/stream/source.mp4',
            duration: 36,
            width: 1280,
            height: 640,
            fps: 24,
            frames: ['C:/media/stream/frame-0.jpg'],
            wave: null,
            cuts: [{ id: 'c1', title: 'Clutch', start: 0, end: 6, shape: 'vertical', fit: 'fill' }],
            selected: 'c1',
          },
        ]),
      );
      localStorage.setItem('quikclip.1.active', JSON.stringify(id));
    }
  }, PROJECT);
  await page.goto('/');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
  await openClipTools(page, 'Frame');
  await page
    .getByRole('group', { name: 'Frame fit' })
    .getByRole('button', { name: 'Facecam + gameplay' })
    .click();
  // The preview draws the facecam band over the gameplay.
  await expect(page.locator('.stage.stack-fill .stage-cam canvas')).toBeVisible();
  const corners = page.getByRole('group', { name: 'Facecam corner' });
  await corners.getByRole('button', { name: 'Bottom right' }).click();
  await expect(corners.getByRole('button', { name: 'Bottom right' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('slider', { name: 'Facecam size' }).fill('0.3');
  // Gameplay is placed by hand; the framing choices don't apply.
  await expect(page.getByRole('group', { name: 'Gameplay position' })).toBeVisible();
  await expect(page.getByText('Framing', { exact: true })).toHaveCount(0);
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
        .request as { fit: string; cam: { x: number; y: number; w: number; h: number } },
  );
  expect(request.fit).toBe('stack');
  expect(request.cam.w).toBeCloseTo(0.3, 5);
  expect(request.cam.x + request.cam.w).toBeCloseTo(1, 5);
  expect(request.cam.y + request.cam.h).toBeCloseTo(1, 5);
});
