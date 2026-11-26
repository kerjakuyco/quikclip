import { expect, test } from '@playwright/test';

test('shows native controls only for an undecorated desktop window', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Window controls' })).toBeHidden();

  await page.addInitScript(() => {
    const webview = window as unknown as Record<string, unknown>;
    const commands: string[] = [];
    let maximized = false;
    webview.isTauri = true;
    webview.windowCommands = commands;
    webview.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      transformCallback: () => 1,
      invoke: async (command: string) => {
        if (command === 'plugin:window|is_decorated') return false;
        if (command === 'plugin:window|is_maximized') return maximized;
        if (command === 'plugin:event|listen') return 1;
        if (command.startsWith('plugin:window|')) commands.push(command);
        if (command === 'plugin:window|toggle_maximize') maximized = !maximized;
        return null;
      },
    };
  });
  await page.reload();

  const controls = page.getByRole('group', { name: 'Window controls' });
  const maximize = controls.getByRole('button', { name: 'Maximize window' });
  const restore = controls.getByRole('button', { name: 'Restore window' });
  await expect(page.locator('.topbar')).toHaveAttribute('data-tauri-drag-region', 'deep');
  await maximize.click();
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(maximize).toBeVisible();
  await controls.getByRole('button', { name: 'Minimize window' }).click();
  await controls.getByRole('button', { name: 'Close window' }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'windowCommands')))
    .toEqual([
      'plugin:window|toggle_maximize',
      'plugin:window|toggle_maximize',
      'plugin:window|minimize',
      'plugin:window|close',
    ]);
});
