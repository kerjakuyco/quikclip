// Maintainer utility: review upstream releases, then commit the generated lockfile.
import { writeFile } from 'node:fs/promises';
const releases = {
  youtube: ['yt-dlp/yt-dlp', '2026.10.26'],
  js: ['quickjs-ng/quickjs', 'v0.18.0'],
  media: ['eugeneware/ffmpeg-static', 'b6.1.1'],
};
const targets = {
  'x86_64-pc-windows-msvc': ['yt-dlp.exe', 'qjs-windows-x86_64.exe', 'win32-x64'],
  'aarch64-apple-darwin': ['yt-dlp_macos', 'qjs-darwin-arm64', 'darwin-arm64'],
  'x86_64-apple-darwin': ['yt-dlp_macos', 'qjs-darwin-x86_64', 'darwin-x64'],
  'x86_64-unknown-linux-gnu': ['yt-dlp_linux', 'qjs-linux-x86_64', 'linux-x64'],
  'aarch64-unknown-linux-gnu': ['yt-dlp_linux_aarch64', 'qjs-linux-aarch64', 'linux-arm64'],
};
const assets = {};
for (const [id, [repo, tag]] of Object.entries(releases)) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`);
  if (!res.ok) throw Error(`${repo}: ${res.status}`);
  assets[id] = (await res.json()).assets;
}
function pin(id, name) {
  const a = assets[id].find((a) => a.name === name);
  if (!a || !/^sha256:[a-f0-9]{64}$/.test(a.digest))
    throw Error(`Missing upstream digest: ${name}`);
  return { url: a.browser_download_url, sha256: a.digest.slice(7) };
}
const lock = {};
for (const [target, [yt, js, platform]] of Object.entries(targets)) {
  lock[target] = {
    'yt-dlp': pin('youtube', yt),
    qjs: pin('js', js),
    ffmpeg: pin('media', `ffmpeg-${platform}`),
    ffprobe: pin('media', `ffprobe-${platform}`),
    'ffmpeg.LICENSE': pin('media', `${platform}.LICENSE`),
    'ffmpeg.README': pin('media', `${platform}.README`),
  };
}
await writeFile(
  new URL('./tools.lock.json', import.meta.url),
  JSON.stringify(lock, null, 2) + '\n',
);
