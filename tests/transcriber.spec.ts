import { expect, test } from '@playwright/test';

const PROJECT = '2b3c4d5e-6f70-4182-93a4-b5c6d7e8f901';

test('speech can be turned into text by a Whisper server on this computer', async ({ page }) => {
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
      invoke: async (cmd: string, args: { connection?: { provider: string } }) => {
        calls.push([cmd, args]);
        if (cmd === 'plugin:event|listen') return next++;
        if (cmd === 'transcribe_source' && args.connection?.provider === 'whisper')
          return {
            language: 'en',
            segments: [{ start: 0.5, end: 2, text: 'Snow on the summits.' }],
            words: [
              { start: 0.5, end: 0.9, text: 'Snow' },
              { start: 0.9, end: 1.1, text: 'on' },
              { start: 1.1, end: 1.4, text: 'the' },
              { start: 1.4, end: 2, text: 'summits.' },
            ],
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
            cuts: [{ id: 'c1', title: 'Opening', start: 0, end: 12, shape: 'source', fit: 'fill' }],
            selected: 'c1',
          },
        ]),
      );
      localStorage.setItem('quikclip.1.active', JSON.stringify(id));
    }
  }, PROJECT);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Transcript' }).click();
  // No cloud provider: the panel offers both ways.
  const local = page.getByRole('form', { name: 'Transcribe on this computer' });
  await expect(local).toBeVisible();
  await local.getByLabel('Port').fill('8080');
  await local.getByLabel(/Model/).fill('ggml-large-v3-turbo');
  await local.getByRole('button', { name: 'Use my Whisper server' }).click();
  await expect(page.getByText('summits.')).toBeVisible();
  const sent = await page.evaluate(() =>
    (window as unknown as { __calls: [string, { connection: unknown }][] }).__calls
      .filter(([cmd]) => cmd === 'transcribe_source')
      .map(([, args]) => args.connection),
  );
  expect(sent.at(-1)).toEqual({ provider: 'whisper', port: 8080, model: 'ggml-large-v3-turbo' });
  // The choice stays for every video after.
  expect(await page.evaluate(() => localStorage.getItem('quikclip.1.transcriber'))).toContain(
    '"port":8080',
  );
});
