import { expect, test, type Page } from '@playwright/test';
import { applyOps } from '../src/assistant';
import type { Project } from '../src/studio';

const PROJECT = '9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b';
type Call = [string, Record<string, unknown>];

async function openDesktop(page: Page, assistant?: 'fail-first') {
  await page.addInitScript(
    ({ id, assistant }) => {
      const w = window as unknown as Record<string, unknown>;
      const calls: [string, unknown][] = [];
      let next = 1;
      let asks = 0;
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
          if (cmd === 'ask_assistant') {
            asks++;
            if (assistant === 'fail-first' && asks === 1)
              throw 'The model took too long to answer. Try again.';
            return JSON.stringify({
              reply: 'Made both clips vertical with Pop captions and added a title.',
              ops: [
                { op: 'update_clip', id: 'all', set: { shape: 'vertical', captions: 'pop' } },
                { op: 'add_text', id: 'c2', text: 'Watch this', at: 0, length: 2 },
                { op: 'launch_rocket' },
              ],
            });
          }
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
                  end: 6,
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
                { id: 'c2', title: 'Middle', start: 10, end: 16, shape: 'source', fit: 'fill' },
                { id: 'c3', title: 'Last', start: 20, end: 26, shape: 'source', fit: 'fill' },
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
    { id: PROJECT, assistant },
  );
  await page.goto('/');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
}
const selected = (page: Page) =>
  page.getByRole('group', { name: 'Clips' }).locator('.cut-card[aria-pressed="true"]');
const playhead = (page: Page) =>
  page.evaluate(() => Math.round(document.querySelector('video')!.currentTime * 10) / 10);

test('keys move between clips, the playhead, and duplicate and remove clips; Undo is one click away', async ({
  page,
}) => {
  await openDesktop(page);
  await page.locator('#timeline-title').click();
  await page.keyboard.press(']');
  await expect(selected(page)).toContainText('Middle');
  await page.keyboard.press('[');
  await expect(selected(page)).toContainText('Opening');
  // End and Home go to the clip's out and in; L and J move five seconds.
  await page.keyboard.press('End');
  await expect.poll(() => playhead(page)).toBe(6);
  await page.keyboard.press('Home');
  await expect.poll(() => playhead(page)).toBe(0);
  await page.keyboard.press('l');
  await expect.poll(() => playhead(page)).toBe(5);
  await page.keyboard.press('j');
  await expect.poll(() => playhead(page)).toBe(0);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => playhead(page)).toBe(1);
  // Duplicate, then remove the copy; the toast brings it back.
  await page.keyboard.press('Control+d');
  await expect(selected(page)).toContainText('Opening (copy)');
  await expect(page.locator('.cut-card')).toHaveCount(4);
  await page.keyboard.press('Delete');
  await expect(page.locator('.cut-card')).toHaveCount(3);
  const toast = page.locator('.toast');
  await expect(toast).toContainText('Removed “Opening (copy)”');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.cut-card')).toHaveCount(4);
  await expect(toast).toHaveCount(0);
  // The shortcut list has them all.
  await page.locator('#timeline-title').click();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toContainText('Previous / next clip');
  await expect(page.getByRole('dialog')).toContainText('Back 5 s / pause / forward 5 s');
});

test('the inspector keeps its tabs across a reload, and a layer opens its settings', async ({
  page,
}) => {
  await openDesktop(page);
  const tools = page.getByRole('tablist', { name: 'Clip settings' });
  await tools.getByRole('tab', { name: 'Audio', exact: true }).click();
  // Double-clicking the text layer in the timeline opens the Text settings.
  await page
    .getByRole('group', { name: 'Layers on this clip' })
    .getByRole('button', { name: /“Hello”/ })
    .dblclick();
  await expect(tools.getByRole('tab', { name: 'Text', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await tools.getByRole('tab', { name: 'B-roll', exact: true }).click();
  await page.getByRole('tab', { name: 'Transcript' }).click();
  await page.reload();
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
  await expect(page.getByRole('tab', { name: 'Transcript' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Clips' }).click();
  await expect(tools.getByRole('tab', { name: 'B-roll', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('the assistant says what each edit changed', () => {
  const project = {
    id: PROJECT,
    title: 'Talk',
    source: 'Local video',
    path: '',
    duration: 36,
    width: 1280,
    height: 640,
    fps: 24,
    frames: [],
    cuts: [
      { id: 'c1', title: 'Opening', start: 0, end: 6, shape: 'source', fit: 'fill' },
      { id: 'c2', title: 'Middle', start: 10, end: 16, shape: 'source', fit: 'fill' },
    ],
    selected: 'c1',
  } as Project;
  const { changes } = applyOps(
    project,
    [
      { op: 'update_clip', id: 'all', set: { shape: 'vertical', captions: 'pop', pauses: true } },
      { op: 'update_clip', id: 'c2', set: { title: 'Payoff', start: 11, end: 15 } },
      { op: 'add_clip', start: 30, end: 34, title: 'Ending' },
      { op: 'remove_clip', id: 'c1' },
    ],
    [],
    PROJECT,
  );
  expect(changes.map((change) => change.text)).toEqual([
    'Every clip: 9:16 frame, Pop captions, pauses cut',
    '“Middle”: renamed “Payoff”, trimmed to 00:11–00:15',
    'Added “Ending”, 00:30–00:34',
    'Removed “Opening”',
  ]);
  expect(changes[1].clip).toBe('c2');
});

test('an answer is a card: what changed, what was skipped, one click to a clip, and a retry after a failure', async ({
  page,
}) => {
  await openDesktop(page, 'fail-first');
  await page.getByRole('tab', { name: 'Assistant' }).click();
  await page
    .getByRole('textbox', { name: 'Ask the assistant' })
    .fill('Make them vertical with Pop captions');
  await page.keyboard.press('Enter');
  const log = page.getByRole('list', { name: 'Conversation' });
  await expect(log.locator('.turn-assistant.failed')).toContainText('took too long');
  await log.getByRole('button', { name: 'Try again' }).click();
  const answer = log.locator('.turn-assistant').last();
  await expect(answer).toContainText('2 edits');
  const changed = answer.getByRole('list', { name: 'What changed' });
  await expect(changed).toContainText('Every clip: 9:16 frame, Pop captions');
  await expect(changed).toContainText('“Middle”: text “Watch this”');
  await expect(answer.getByRole('list', { name: 'Not done' })).toContainText(
    "Skipped an edit the studio doesn't know (launch_rocket)",
  );
  await changed.getByRole('listitem').filter({ hasText: 'Middle' }).getByRole('button').click();
  await page.getByRole('tab', { name: 'Clips' }).click();
  await expect(selected(page)).toContainText('Middle');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __calls: Call[] }).__calls.filter(([c]) => c === 'ask_assistant')
          .length,
    ),
  ).toBe(2);
});
