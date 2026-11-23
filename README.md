# Quikclip Studio

[![CI](https://github.com/kerjakuyco/quikclip/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/kerjakuyco/quikclip/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/license-GPLv3-blue)](LICENSE)
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-%40kerjakuyco-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/kerjakuyco)

**Turn a long video into a short, shareable clip on your own machine.** Import a file or YouTube video, pick highlights manually or with a local vision model, and export a landscape, square, or portrait cut.

Quikclip is an open-source desktop app built with Tauri 2, Rust, React, and TypeScript for Windows, macOS, and Linux. The bundled *Alpine field notes* project lets you try the editor immediately.

![Quikclip Studio showing the source monitor, clip bin, trim timeline, and output framing controls](docs/studio.jpg)

## Run the desktop app

1. Install Node.js 22.12+ (or current LTS), stable Rust, and the [Tauri desktop prerequisites for your OS](https://v2.tauri.app/start/prerequisites/).
2. Install [FFmpeg](https://ffmpeg.org/download.html) with `ffmpeg`, `ffprobe`, H.264 encoding (`libx264`), and AAC support. Add both executables to the app's `PATH`.
3. For YouTube imports, install the current [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) and its [YouTube JavaScript runtime dependencies](https://github.com/yt-dlp/yt-dlp/wiki/EJS). Local files do not require yt-dlp.

```sh
git clone https://github.com/kerjakuyco/quikclip.git
cd quikclip
npm ci
npm run tauri dev
```

On macOS, if the desktop launcher cannot find Homebrew tools, start Quikclip from a terminal with the Homebrew `bin` directory on `PATH`. Linux needs WebKitGTK 4.1 and GStreamer H.264/AAC playback plugins in addition to FFmpeg.

## Edit a clip

- **Import media** opens a native file picker or accepts a YouTube watch, Shorts, or `youtu.be` URL. Desktop imports are normalized into a local H.264 editing copy, with thumbnails and a waveform when audio is present. The editing copy is capped at 1920 × 1080 and preserves the source aspect ratio. The original is untouched.
- **Clip bin** holds independent, named cuts from one source. Select a cut, drag the range handles, or enter exact in/out times. Click the filmstrip to scrub; **Add clip** starts a cut at the playhead.
- **Output frame** previews the same centered crop used by the renderer: original, portrait 9:16, or square 1:1. Enable the loop control to review just the selection.
- **Export clip** renders the selected range to MP4 (H.264 and optional AAC). Choose the destination in the OS save dialog. Completed renders appear under **Exports**.
- **Workspace** changes are saved locally. Media lives under the platform's app-local-data directory for `studio.quikclip.desktop`, in `media/<id>/`; the webview stores cut metadata and export history. Development and packaged origins may have separate workspace metadata.

| Shortcut | Action |
| --- | --- |
| Space | Play or pause |
| ← / → | Step backward / forward one frame |
| I / O | Set in / out at the playhead |
| M | Mute the monitor |
| ? | Show shortcuts |

## Local AI highlight finder

Install [Ollama](https://ollama.com/download), start its local service, and pull the vision model:

```sh
ollama pull gemma3:4b
```

Click **Find highlights → Analyze source**. Rust samples nine frames across the source, builds a contact sheet, and asks Ollama at `127.0.0.1:11434` for timestamped suggestions. Quikclip validates the ranges and adds up to three named cuts without replacing existing work. This is visual analysis, not speech transcription. The sample project's three initial cuts are curated examples.

To use another installed vision model, set `QUIKCLIP_MODEL` to its exact Ollama tag before launching the app. No hosted account or API key is required.

## Browser preview

```sh
npm run dev
```

Visit `http://127.0.0.1:1420`. The browser can play the sample, import browser-decodable local files, keep media in IndexedDB, edit cuts, and export WebM with WebCodecs and Mediabunny. YouTube downloads, local-model analysis, and native MP4 rendering run in the desktop build.

## Packaging and checks

```sh
npm run tauri build
```

Build on the target OS to produce its installers under `src-tauri/target/release/bundle/`. The **Desktop packages** workflow can build Windows, macOS, and Linux artifacts on their native runners. These developer packages are unsigned. Media tools and model weights are installed separately.

```sh
npm run build
npx playwright install chromium
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

The Playwright suite imports and plays a real video, verifies persisted trims, and encodes a cropped clip. Use `PLAYWRIGHT_CHANNEL=msedge` to test with installed Microsoft Edge. Native tests cover URL validation, range validation, and FFmpeg output duration, frame size, and audio.

On Windows, `node scripts/smoke-windows.mjs` verifies sample playback and native IPC in a packaged debug build using an isolated WebView2 profile.

## Project layout

- `src/` — editing workspace, source monitor, timeline, clip settings, local storage, browser media adapter.
- `src-tauri/src/media.rs` — native file dialogs, URL canonicalization, bounded media subprocesses, import and atomic export.
- `src-tauri/src/ai.rs` — local vision inference and suggestion validation.
- `src-tauri/src/jobs.rs` — single active media job, asynchronous dispatch and cancellation.
- `public/sample/` — bundled, offline sample film. Credits in [CREDITS.md](CREDITS.md).

## Contribute

Bug reports, patches, and feedback from editors on all three platforms are welcome. Start with the [contributing guide](CONTRIBUTING.md), [report a bug or propose a feature](https://github.com/kerjakuyco/quikclip/issues/new/choose), or read the [security reporting policy](SECURITY.md).

## Support Quikclip

If Quikclip is useful to you, [sponsor **@kerjakuyco** on GitHub](https://github.com/sponsors/kerjakuyco) to support its ongoing development. Sharing a reproducible issue or testing a build on your platform also helps.

## License

Quikclip's source code is licensed under the [GNU General Public License v3.0](LICENSE). See [credits](CREDITS.md) for the licenses of sample media, icons, and fonts.
