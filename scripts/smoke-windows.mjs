// Exercise the packaged webview and native IPC with an isolated WebView2 profile.
// Run after `npx tauri build --debug --bundles nsis` on Windows.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';

const profile = await mkdtemp(path.join(tmpdir(), 'quikclip-smoke-'));
const socket = createServer().listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const endpoint = `http://127.0.0.1:${port}`;
const child = spawn(path.resolve('src-tauri/target/debug/quikclip.exe'), [], {
  stdio: 'inherit',
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
});
const exited = once(child, 'exit');
try {
  await expect.poll(async () => {
    try { return (await fetch(`${endpoint}/json/version`)).ok; } catch { return false; }
  }, { timeout: 45000 }).toBe(true);
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page');
  await expect(page.getByRole('heading', { name: 'Alpine field notes' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
  const error = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('import_youtube', { url: 'not-a-video' }).catch(String));
  expect(error).toContain('YouTube video');
  console.log('Packaged studio: sample playback and native import IPC verified.');
} finally {
  child.kill();
  await exited;
  await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
}
