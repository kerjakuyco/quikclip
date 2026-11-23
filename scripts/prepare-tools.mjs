// Build-time only. The installed desktop app never downloads executable code.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const lock = JSON.parse(await readFile(new URL('./tools.lock.json', import.meta.url), 'utf8'));
const target =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (\S+)/m)?.[1];
if (!lock[target])
  throw Error(
    `No pinned media tools for ${target}. Build for one of: ${Object.keys(lock).join(', ')}.`,
  );
const root = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const binaries = path.join(root, 'binaries'),
  notices = path.join(root, 'tool-notices');
await mkdir(binaries, { recursive: true });
await mkdir(notices, { recursive: true });
async function digest(file) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}
for (const [tool, { url, sha256 }] of Object.entries(lock[target])) {
  const notice = tool.includes('.');
  const output = notice
    ? path.join(notices, tool)
    : path.join(binaries, `quikclip-${tool}-${target}${target.includes('windows') ? '.exe' : ''}`);
  if ((await digest(output).catch(() => null)) === sha256) continue;
  console.log(`Preparing ${tool} for ${target}…`);
  const temp = `${output}.${process.pid}.part`;
  try {
    execFileSync(
      process.platform === 'win32' ? 'curl.exe' : 'curl',
      [
        '--fail',
        '--silent',
        '--show-error',
        '--location',
        '--proto',
        '=https',
        '--retry',
        '3',
        '--connect-timeout',
        '20',
        '--max-time',
        '600',
        '--output',
        temp,
        url,
      ],
      { stdio: 'inherit' },
    );
    if ((await digest(temp)) !== sha256) throw Error(`Integrity check failed for ${tool}.`);
    if (!notice) await chmod(temp, 0o755);
    await rename(temp, output);
  } finally {
    await rm(temp, { force: true });
  }
}
console.log(`Desktop media tools ready (${target}).`);
