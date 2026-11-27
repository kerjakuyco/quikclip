import { openClipTools } from './clip-tools';
import { expect, test, type Page } from '@playwright/test';
import { applyOps, parseAssistant } from '../src/assistant';
import { BUILT_IN_LOOKS } from '../src/look';
import type { Project } from '../src/studio';

const PROJECT = '6d5c4b3a-2f1e-4d0c-9b8a-7f6e5d4c3b2a';
const project = {
  id: PROJECT,
  title: 'Talk',
  source: 'Local video',
  path: 'C:/a.mp4',
  duration: 36,
  width: 1280,
  height: 640,
  fps: 24,
  frames: [],
  cuts: [
    { id: 'c1', title: 'Opening', start: 0, end: 12, shape: 'source', fit: 'fill' },
    { id: 'c2', title: 'Later', start: 14, end: 24, shape: 'source', fit: 'fill' },
  ],
  selected: 'c1',
} as Project;

test('the assistant’s answer is read, and only edits the studio knows are applied', () => {
  expect(
    parseAssistant('```json\n{"reply":"Done it.","ops":[{"op":"select_clip","id":"c2"}]}\n```'),
  ).toEqual({
    reply: 'Done it.',
    ops: [{ op: 'select_clip', id: 'c2' }],
  });
  expect(parseAssistant('I cannot help with that.').ops).toEqual([]);
  const {
    project: edited,
    applied,
    skipped,
  } = applyOps(
    project,
    [
      {
        op: 'update_clip',
        id: 'all',
        set: { shape: 'vertical', captions: 'pop', speed: 1.25, volume: 11 },
      },
      { op: 'update_clip', id: 'c1', set: { start: -5, end: 99, title: '  New   name ' } },
      { op: 'add_clip', start: 30, end: 50, title: 'Ending' },
      { op: 'apply_look', id: 'c2', look: 'quote card' },
      { op: 'add_text', id: 'c1', text: 'Watch this', at: 2, length: 90 },
      { op: 'remove_clip', id: 'nope' },
      { op: 'launch_rocket' },
    ],
    BUILT_IN_LOOKS,
    PROJECT,
  );
  expect(applied).toBe(5);
  expect(skipped).toHaveLength(2);
  expect(edited.cuts[0]).toMatchObject({
    title: 'New name',
    start: 0,
    end: 36,
    shape: 'vertical',
    speed: 1.25,
    captions: { style: 'pop' },
  });
  expect(edited.cuts[0].texts?.[0]).toMatchObject({ text: 'Watch this', at: 2, length: 34 });
  expect(edited.cuts[1]).toMatchObject({ shape: 'square', fit: 'blur' });
  // A new clip stays inside the video, and is chosen.
  expect(edited.cuts[2]).toMatchObject({ title: 'Ending', start: 30, end: 36 });
  expect(edited.selected).toBe(edited.cuts[2].id);
  // Never every clip.
  expect(applyOps(project, [{ op: 'remove_clip', id: 'all' }], [], PROJECT).applied).toBe(0);
});

type Call = [string, Record<string, unknown>];
const calls = (page: Page, cmd: string) =>
  page.evaluate(
    (name) =>
      (window as unknown as { __calls: Call[] }).__calls
        .filter(([c]) => c === name)
        .map(([, args]) => args),
    cmd,
  );

test('ask the assistant for edits, undo them, and write post copy for a clip', async ({ page }) => {
  await page.addInitScript(
    ({ id, seeded }) => {
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
              segments: [{ start: 0, end: 4, text: 'Up here the light changes everything.' }],
              words: [
                { start: 0, end: 1, text: 'Up' },
                { start: 1, end: 2, text: 'here' },
              ],
            };
          if (cmd === 'ask_assistant')
            return JSON.stringify({
              reply: 'Made both clips vertical with Pop captions.',
              ops: [{ op: 'update_clip', id: 'all', set: { shape: 'vertical', captions: 'pop' } }],
            });
          if (cmd === 'write_post_copy')
            return [
              { platform: 'tiktok', caption: 'Wait for the light.', hashtags: ['alps', 'sunrise'] },
              {
                platform: 'youtube',
                title: 'The light up here',
                caption: 'Dawn above the clouds.',
                hashtags: ['hiking'],
              },
            ];
          return null;
        },
      };
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.clear();
        localStorage.setItem('quikclip.1.projects', JSON.stringify([seeded]));
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
    {
      id: PROJECT,
      seeded: {
        ...project,
        path: 'C:/media/talk/source.mp4',
        frames: ['C:/media/talk/frame-0.jpg'],
        wave: null,
      },
    },
  );
  await page.goto('/');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
  await page.getByRole('tab', { name: 'Assistant' }).click();
  await page.getByLabel('Ask the assistant').fill('Make everything vertical with pop captions');
  await page.getByRole('button', { name: 'Send' }).click();
  const log = page.getByRole('list', { name: 'Conversation' });
  await expect(log).toContainText('Make everything vertical with pop captions');
  await expect(log).toContainText('Made both clips vertical with Pop captions.');
  const [asked] = (await calls(page, 'ask_assistant')) as { model: string; context: string }[];
  expect(asked.model).toBe('gemma3:4b');
  expect(asked.context).toContain('"id": "c2"');
  expect(asked.context).toContain('[0.0-4.0] Up here the light changes everything.');
  await page.getByRole('tab', { name: 'Clips' }).click();
  const frame = page.getByRole('group', { name: 'Output frame' });
  await expect(frame.getByRole('button', { name: '9:16' })).toHaveAttribute('aria-pressed', 'true');
  // One undo takes the whole answer back.
  await page.getByRole('tab', { name: 'Assistant' }).click();
  await page.getByRole('button', { name: 'Undo these changes' }).click();
  await page.getByRole('tab', { name: 'Clips' }).click();
  await expect(frame.getByRole('button', { name: 'Original' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Post copy for the clip, kept on it.
  await openClipTools(page, 'Post copy');
  await page.getByRole('button', { name: 'Write post copy' }).click();
  await expect(page.getByRole('article', { name: 'Shorts post' })).toContainText(
    'The light up here',
  );
  await expect(page.getByRole('article', { name: 'TikTok post' })).toContainText('#alps #sunrise');
  const [written] = (await calls(page, 'write_post_copy')) as {
    clip: { transcript: string };
    platforms: string[];
    tone: string;
  }[];
  expect(written).toMatchObject({
    clip: { transcript: 'Up here' },
    platforms: ['tiktok', 'instagram', 'youtube'],
    tone: 'friendly',
  });
  await page.reload();
  await openClipTools(page, 'Post copy');
  await expect(page.getByRole('article', { name: 'TikTok post' })).toBeVisible();
});
