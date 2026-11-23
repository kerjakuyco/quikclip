import { test, expect } from '@playwright/test';
import { stat } from 'node:fs/promises';

test('edit and persist a cut, then render the selected range', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Alpine field notes' })).toBeVisible();
  await page.locator('.cut-card').nth(1).click();
  await page.getByLabel('In point', { exact: true }).fill('13');
  await page.getByLabel('In point', { exact: true }).press('Enter');
  await page.getByLabel('Out point', { exact: true }).fill('14.5');
  await page.getByLabel('Out point', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '9:16', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('In point', { exact: true })).toHaveValue('00:13.00');
  await expect(page.getByLabel('Out point', { exact: true })).toHaveValue('00:14.50');
  await expect(page.getByRole('button', { name: '9:16', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Export clip', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export WebM', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('Into the valley.webm');
  expect((await stat((await download.path())!)).size).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  await expect(page.locator('.export-row')).toContainText('Into the valley');
});

test('import a real local file, reopen its saved bytes and play it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import media', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles('public/sample/alpine.mp4');
  await expect(page.getByRole('heading', { name: 'alpine', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'alpine', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeGreaterThan(0.2);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Add clip' }).click();
  await expect(page.locator('.cut-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Media library', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(2);
});
