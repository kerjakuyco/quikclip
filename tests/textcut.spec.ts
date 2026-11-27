import { expect, test, type Page } from '@playwright/test';
import { cutSeconds, cutWords, spansOf, toggleWords } from '../src/textcut';

const words = [
  { index: 0, start: 0.2, end: 0.5, text: 'So' },
  { index: 1, start: 0.6, end: 1.0, text: 'what' },
  { index: 2, start: 1.1, end: 1.5, text: 'happened' },
  { index: 3, start: 1.6, end: 2.0, text: 'next' },
  { index: 4, start: 2.4, end: 2.9, text: 'surprised' },
  { index: 5, start: 3.0, end: 3.4, text: 'everyone.' },
];

test('words cut from a clip become spans that reach into the quiet, never a kept word', () => {
  // A run of words is one span, padded 20 ms each side but not past its neighbours.
  const one = toggleWords(words, [], 1, 2);
  expect(one).toEqual([[0.58, 1.52]]);
  expect([...cutWords(words, one)]).toEqual([1, 2]);
  // Next to an earlier cut, the two runs join.
  const two = toggleWords(words, one, 3, 3);
  expect(two).toEqual([[0.58, 2.02]]);
  // Dragging over words that are all cut brings them back.
  expect(toggleWords(words, two, 2, 1)).toEqual([[1.58, 2.02]]);
  // Mixed runs are cut whole.
  expect(spansOf(words, new Set([4, 5]))).toEqual([[2.38, 3.42]]);
  expect(cutSeconds(two)).toBe(1.4);
});

type Call = [string, Record<string, unknown>];
const PROJECT = '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d';

async function openDesktop(page: Page) {
  await page.addInitScript(
    ({ id, words }) => {
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
              segments: [
                { start: 0.2, end: 3.4, text: 'So what happened next surprised everyone.' },
              ],
              words: words.map(({ start, end, text }) => ({ start, end, text })),
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
                {
                  id: 'c1',
                  title: 'Opening',
                  start: 0,
                  end: 4,
                  shape: 'source',
                  fit: 'fill',
                  captions: { style: 'clean' },
                },
              ],
              selected: 'c1',
            },
          ]),
        );
        localStorage.setItem('quikclip.1.active', JSON.stringify(id));
      }
    },
    { id: PROJECT, words },
  );
  await page.goto('/');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
}

test('cut words by dragging over them in the transcript; the export and captions leave them out', async ({
  page,
}) => {
  await openDesktop(page);
  await page.getByRole('tab', { name: 'Transcript' }).click();
  await page.getByRole('button', { name: 'Cut words' }).click();
  const transcript = page.getByRole('list', { name: 'Transcript' });
  const what = transcript.getByText('what', { exact: true });
  const happened = transcript.getByText('happened', { exact: true });
  await what.hover();
  await page.mouse.down();
  await happened.hover();
  await expect(happened).toHaveClass(/pending/);
  await page.mouse.up();
  await expect(what).toHaveClass(/cut/);
  await expect(happened).toHaveClass(/cut/);
  await expect(page.locator('.transcript-hint').first()).toContainText('2 words cut from the clip');
  // The export cuts them out.
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
        .request as { drops: number[][]; captions: string },
  );
  expect(request.drops).toEqual([[0.58, 1.52]]);
  const captioned = JSON.parse(request.captions) as { cues: { text: string }[] };
  const said = captioned.cues.map((cue) => cue.text).join(' ');
  expect(said).not.toContain('happened');
  expect(said).toContain('surprised');
  // And they come back.
  await page.getByRole('button', { name: /Bring back every cut word/ }).click();
  await expect(what).not.toHaveClass(/cut/);
});
