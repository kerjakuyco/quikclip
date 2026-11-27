import { openClipTools } from './clip-tools';
import { expect, test } from '@playwright/test';
import { commandScore } from '../src/components/CommandPalette';

test('the palette ranks label starts first and needs every word', () => {
  const frame = { label: 'Frame: 9:16', group: 'Clip', keywords: 'Vertical aspect ratio' };
  const look = { label: 'Apply look: Bold creator', group: 'Looks' };
  expect(commandScore(frame, 'vertical')).toBeGreaterThan(0);
  expect(commandScore(frame, 'frame')).toBeGreaterThan(commandScore(look, 'look'));
  expect(commandScore(look, 'bold look')).toBeGreaterThan(0);
  expect(commandScore(look, 'bold square')).toBe(0);
  expect(commandScore(look, '')).toBe(1);
});

test('Ctrl+K finds and runs any action, from the keyboard or the top bar', async ({ page }) => {
  await page.goto('/');
  const frame = page.getByRole('group', { name: 'Output frame' });
  // The shortcut listens once the editor is up.
  await expect(frame).toBeVisible();
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('vertical');
  await expect(palette.getByRole('option').first()).toContainText('Frame: 9:16');
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(frame.getByRole('button', { name: '9:16' })).toHaveAttribute('aria-pressed', 'true');
  // Arrow keys move through the matches; Enter runs the chosen one.
  await page.getByRole('button', { name: 'Command palette' }).click();
  await page.keyboard.type('captions');
  const options = palette.getByRole('option');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('captions pop');
  await page.keyboard.press('Enter');
  await openClipTools(page, 'Captions');
  await expect(
    page.getByRole('group', { name: 'Caption style' }).getByRole('button', { name: 'Pop' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // Clips, looks and undo are there too; Escape closes without running anything.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('go to clip still');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Clip name')).toHaveValue('Still waters');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('nothing like this');
  await expect(palette).toContainText('Nothing matches');
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
});
