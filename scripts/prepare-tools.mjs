// Build-time only. The installed desktop app never downloads executable code.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
function download(url, file) {
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
      '1200',
      '--output',
      file,
      url,
    ],
    { stdio: 'inherit' },
  );
}
// Some tools ship only inside an archive. Each archive is fetched once per run and checked against
// its pinned digest before anything is taken out of it. Windows' own tar.exe (bsdtar) reads zip;
// a Git or MSYS tar earlier on PATH would not.
const scratch = await mkdtemp(path.join(tmpdir(), 'quikclip-tools-'));
const archives = new Map();
async function archive(url, sha256, tool) {
  if (!archives.has(url)) {
    const file = path.join(scratch, `archive-${archives.size}`);
    download(url, file);
    if ((await digest(file)) !== sha256) throw Error(`Integrity check failed for ${tool} archive.`);
    archives.set(url, file);
  }
  return archives.get(url);
}
const tar =
  process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
async function extract(file, member, output) {
  const dir = await mkdtemp(path.join(scratch, 'x-'));
  execFileSync(tar, ['-xf', file, '-C', dir, member], { stdio: 'inherit' });
  await rename(path.join(dir, ...member.split('/')), output);
}
try {
  for (const [tool, entry] of Object.entries(lock[target])) {
    const { url, sha256, extract: member, extractSha256 } = entry;
    const want = member ? extractSha256 : sha256;
    const notice = tool.includes('.');
    const output = notice
      ? path.join(notices, tool)
      : path.join(
          binaries,
          `quikclip-${tool}-${target}${target.includes('windows') ? '.exe' : ''}`,
        );
    if ((await digest(output).catch(() => null)) === want) continue;
    console.log(`Preparing ${tool} for ${target}…`);
    const temp = `${output}.${process.pid}.part`;
    try {
      if (member) await extract(await archive(url, sha256, tool), member, temp);
      else download(url, temp);
      if ((await digest(temp)) !== want) throw Error(`Integrity check failed for ${tool}.`);
      if (!notice) await chmod(temp, 0o755);
      await rename(temp, output);
    } finally {
      await rm(temp, { force: true });
    }
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
console.log(`Desktop media tools ready (${target}).`);
