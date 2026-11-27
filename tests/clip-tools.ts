import type { Page } from '@playwright/test';

/** Which of the inspector's clip setting tabs holds each group of settings. */
const TOOL_FOR: Record<string, string> = {
  Frame: 'Frame',
  Captions: 'Text',
  'Text on video': 'Text',
  'Headline and logo': 'Text',
  Audio: 'Audio',
  'B-roll': 'B-roll',
  'Post copy': 'Post',
};

export function clipTool(page: Page, section: string) {
  return page
    .getByRole('tablist', { name: 'Clip settings' })
    .getByRole('tab', { name: TOOL_FOR[section] ?? section, exact: true });
}

/** Shows the clip settings tab holding `section`. */
export async function openClipTools(page: Page, section: string) {
  await clipTool(page, section).click();
}
