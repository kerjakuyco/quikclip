import { expect, test, type Page } from '@playwright/test';
import { openClipTools } from './clip-tools';
import { calloutLayers, clipPayload, suggestedCuts, takeCuts } from '../src/suggest';

const words = [
  { index: 0, start: 0.2, end: 0.5, text: 'So' },
  { index: 1, start: 0.6, end: 1.0, text: 'so' },
  { index: 2, start: 1.1, end: 1.5, text: 'what' },
  { index: 3, start: 1.6, end: 2.0, text: 'happened' },
  { index: 4, start: 2.4, end: 2.9, text: 'at' },
  { index: 5, start: 3.0, end: 3.4, text: 'Denali?' },
];

test('suggestions become cuts, callouts and payloads the studio can use', () => {
  expect(clipPayload({ title: 'Talk', start: 10, end: 14 }, [words[1]], 'en')).toEqual({
    title: 'Talk',
    headline: '',
    words: [{ text: 'so', at: 0 }],
    length: 4,
    language: 'en',
  });
  // Word numbers are places in the list the model was sent, which skips words already cut.
  const sent = [words[0], words[1], words[2], words[5]];
  const cuts = suggestedCuts(sent, [
    { from: 0, to: 1, why: 'false start' },
    { from: 9, to: 9, why: 'not a word' },
  ]);
  expect(cuts).toEqual([{ span: [0.18, 1.02], words: [0, 1], why: 'false start' }]);
  expect(takeCuts([[3, 3.42]], cuts)).toEqual([
    [0.18, 1.02],
    [3, 3.42],
  ]);
  const layers = calloutLayers(
    [
      { text: 'Denali', at: 1, length: 2 },
      { text: 'Two', at: 2, length: 2 },
    ],
    7,
  );
  expect(layers).toHaveLength(1);
  expect(layers[0]).toMatchObject({ text: 'Denali', preset: 'label', at: 1, length: 2 });
});

type Call = [string, Record<string, unknown>];
const PROJECT = '3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a6b7';
const calls = (page: Page, cmd: string) =>
  page.evaluate(
    (name) =>
      (window as unknown as { __calls: Call[] }).__calls
        .filter(([c]) => c === name)
        .map(([, args]) => args),
    cmd,
  );

async function openStudio(page: Page) {
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
        invoke: async (cmd: string, args: { task?: string }) => {
          calls.push([cmd, args]);
          if (cmd === 'plugin:event|listen') return next++;
          if (cmd === 'read_transcript')
            return {
              language: 'en',
              segments: [{ start: 0.2, end: 3.4, text: 'So so what happened at Denali?' }],
              words: words.map(({ start, end, text }) => ({ start, end, text })),
            };
          if (cmd === 'ask_assistant') return JSON.stringify({ reply: 'Renamed it.', ops: [] });
          if (cmd !== 'suggest_for_clip') return null;
          const answers: Record<string, unknown> = {
            titles: { task: 'titles', options: ['The Denali question', 'What happened'] },
            hooks: { task: 'hooks', options: ['Nobody expected this'] },
            tighten: { task: 'tighten', cuts: [{ from: 0, to: 0, why: 'false start' }] },
            keywords: { task: 'keywords', words: ['denali', 'happened'] },
            callouts: { task: 'callouts', texts: [{ text: 'Denali', at: 2.9, length: 2 }] },
          };
          return answers[args.task ?? ''];
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
                  end: 5,
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
        localStorage.setItem(
          'quikclip.1.ai.providers',
          JSON.stringify({
            active: 'ollama',
            profiles: {
              ollama: {
                connection: { provider: 'ollama', port: 11434 },
                models: [],
                model: 'gemma3:4b',
                custom: false,
              },
            },
          }),
        );
      }
    },
    { id: PROJECT, words },
  );
  await page.goto('/');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
}
const savedCut = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('quikclip.1.projects')!)[0].cuts[0] as {
        title: string;
        headline?: string;
        removed?: number[][];
        texts?: { text: string }[];
        captions?: { keywords?: string[] };
      },
  );

test('the AI works beside each field: titles, hooks, keywords and callouts', async ({ page }) => {
  await openStudio(page);
  // Titles by the clip name.
  await page.getByRole('button', { name: 'Suggest titles' }).click();
  const titles = page.getByRole('group', { name: 'Suggest titles: suggestions' });
  await titles.getByRole('button', { name: 'The Denali question' }).click();
  await expect(titles).toHaveCount(0);
  await expect.poll(async () => (await savedCut(page)).title).toBe('The Denali question');
  const sent = (await calls(page, 'suggest_for_clip'))[0] as {
    task: string;
    model: string;
    clip: { words: { text: string }[]; length: number };
  };
  expect(sent).toMatchObject({ task: 'titles', model: 'gemma3:4b', clip: { length: 5 } });
  expect(sent.clip.words.map((word) => word.text)).toEqual([
    'So',
    'so',
    'what',
    'happened',
    'at',
    'Denali?',
  ]);
  // Hooks by the headline, keywords in the captions, and callouts by the text tools.
  await openClipTools(page, 'Headline and logo');
  await page.getByRole('button', { name: 'Suggest hooks' }).click();
  await page.getByRole('button', { name: 'Nobody expected this' }).click();
  await expect(page.getByRole('textbox', { name: 'Headline' })).toHaveValue('Nobody expected this');
  await page.getByRole('button', { name: 'Suggest keywords' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Lit up 2 keywords' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Keywords', exact: true })).toHaveValue(
    'denali, happened',
  );
  await page.getByRole('button', { name: 'Suggest callouts' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added 1 callout' })).toBeVisible();
  await expect
    .poll(async () => (await savedCut(page)).texts?.map((text) => text.text))
    .toEqual(['Denali']);
  expect((await savedCut(page)).captions?.keywords).toEqual(['denali', 'happened']);
  // The callout shows in the timeline's Layers lane.
  await expect(
    page
      .getByRole('group', { name: 'Layers on this clip' })
      .getByRole('button', { name: /Denali/ }),
  ).toBeVisible();
});

test('tighten a clip with AI: suggested cuts are marked in the transcript and taken from there', async ({
  page,
}) => {
  await openStudio(page);
  await page.getByRole('tab', { name: 'Transcript' }).click();
  await page.getByRole('button', { name: 'Tighten with AI' }).click();
  const suggested = page.getByRole('region', { name: 'Suggested cuts' });
  await expect(suggested).toContainText('1 suggested cut');
  await expect(suggested).toContainText('false start');
  const transcript = page.getByRole('list', { name: 'Transcript' });
  await expect(transcript.getByText('So', { exact: true })).toHaveClass(/suggested/);
  await suggested.getByRole('button', { name: 'Cut “So”' }).click();
  await expect(suggested).toHaveCount(0);
  await expect(transcript.getByText('So', { exact: true })).toHaveClass(/cut/);
  await expect.poll(async () => (await savedCut(page)).removed).toEqual([[0.18, 0.52]]);
});

test('the command palette runs AI actions and passes a question to the assistant', async ({
  page,
}) => {
  await openStudio(page);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox').fill('light up keywords');
  await palette.getByRole('option', { name: /Light up caption keywords/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Lit up 2 keywords' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await palette.getByRole('combobox').fill('rename this clip to Summit talk');
  await expect(palette.getByRole('option').first()).toContainText('Ask the assistant');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await calls(page, 'ask_assistant')).length).toBe(1);
  expect((await calls(page, 'ask_assistant'))[0]).toMatchObject({
    instruction: 'rename this clip to Summit talk',
  });
});
