// Exercise the packaged webview and native IPC with an isolated WebView2 profile.
// Run after `npx tauri build --debug --bundles nsis` on Windows.
import { execFileSync, spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
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
// No media tools, runtimes or provider credentials are needed on the host.
const testEnv = { ...process.env };
for (const k of Object.keys(testEnv)) if (k.toLowerCase() === 'path') delete testEnv[k];
testEnv.Path = path.join(process.env.SystemRoot, 'System32');
const bin = path.resolve('src-tauri/target/debug');
for (const tool of ['yt-dlp', 'qjs', 'ffmpeg', 'ffprobe']) {
  execFileSync(
    path.join(bin, `quikclip-${tool}.exe`),
    [tool === 'qjs' ? '--version' : tool === 'yt-dlp' ? '--version' : '-version'],
    { env: testEnv },
  );
}
let receivedImage = false;
const modelServer = createHttpServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  let out;
  if (req.url === '/api/tags')
    out = { models: [{ name: 'fixture:first' }, { name: 'fixture:selected' }] };
  else if (req.url === '/api/show') out = { capabilities: ['vision'] };
  else if (req.url === '/api/generate' && body.model === 'fixture:selected') {
    receivedImage = Buffer.from(body.images[0], 'base64')
      .subarray(0, 2)
      .equals(Buffer.from([255, 216]));
    out = {
      response: JSON.stringify({ clips: [{ title: 'Fixture highlight', start: 2, end: 6 }] }),
    };
  } else {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(out));
}).listen(0, '127.0.0.1');
await once(modelServer, 'listening');
const child = spawn(path.resolve('src-tauri/target/debug/quikclip.exe'), [], {
  stdio: 'inherit',
  env: {
    ...testEnv,
    WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
});
const exited = once(child, 'exit');
try {
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${endpoint}/json/version`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 45000 },
    )
    .toBe(true);
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent('page'));
  await expect(page.getByRole('heading', { name: 'Alpine field notes' })).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v) => v.currentTime))
    .toBeGreaterThan(0.1);
  const error = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('import_youtube', { url: 'not-a-video' }).catch(String),
  );
  expect(error).toContain('YouTube video');
  await page.getByRole('button', { name: 'Find highlights' }).click();
  await page.getByLabel('Local server port').fill(String(modelServer.address().port));
  await page.getByRole('button', { name: 'Connect & load models' }).click();
  await page.getByLabel('Vision model').selectOption('fixture:selected');
  await page.getByRole('button', { name: 'Analyze source' }).click();
  await expect(page.getByRole('button', { name: /Fixture highlight/ })).toBeVisible({
    timeout: 30000,
  });
  expect(receivedImage).toBeTruthy();
  console.log(
    'Verified bundled tools without PATH, playback, native IPC, model selection and analyzed contact sheet.',
  );
} finally {
  modelServer.close();
  child.kill();
  await exited;
  await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
}
