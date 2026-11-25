# Quikclip Studio

[![CI](https://github.com/kerjakuyco/quikclip/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/kerjakuyco/quikclip/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/license-GPLv3-blue)](LICENSE)
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-%40kerjakuyco-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/kerjakuyco)

**Turn a long video into a short, shareable clip on your own machine.** Import a file or YouTube video, find highlights manually or with your choice of local or cloud AI, and export a landscape, square, or portrait cut.

Quikclip is an open-source desktop app built with Tauri 2, Rust, React, and TypeScript for Windows, macOS, and Linux. The bundled *Alpine field notes* project lets you try the editor immediately.

![Quikclip Studio showing the source monitor, clip bin, trim timeline, and output framing controls](docs/studio.jpg)

## Run the desktop app

**Installed app:** Open **Import media → YouTube URL**, paste a video link, and choose **Import video**. The installer includes yt-dlp, its JavaScript runtime, FFmpeg, and ffprobe. No separate downloader, Python installation, or `PATH` setup is needed.

**From source:** Install Node.js 22.12+ (or current LTS), stable Rust, and the [Tauri desktop prerequisites for your OS](https://v2.tauri.app/start/prerequisites/), then run:

```sh
git clone https://github.com/kerjakuyco/quikclip.git
cd quikclip
npm ci
npm run tauri dev
```

The first desktop build downloads and verifies pinned tools for the target. Later builds reuse the verified copies. Linux uses WebKitGTK 4.1, GStreamer H.264/AAC playback plugins, and (for saved API tokens) a Secret Service keyring.

## Edit a clip

- **Import media** opens a native file picker or accepts a YouTube watch, Shorts, or `youtu.be` URL. Desktop imports prepare a local editing copy with timeline thumbnails. The project opens as soon as that is done; the audio waveform is drawn in the background (about 25 seconds per hour of audio) and appears in the timeline when ready. The editing copy is capped at 1920 × 1080 and preserves the source aspect ratio. The original is untouched. Sources up to 12 hours are supported, and most import in seconds to a minute whatever their length, because nothing is re-encoded when it does not have to be:

  - Links download H.264 and AAC when the site offers them at the same resolution and frame rate.
  - H.264 sources, and HEVC, AV1, or VP9 sources that the app's player reports it can play, are copied into the project as they are (8-bit, up to 1080p, upright). Opus audio is kept when the player supports it; other audio is converted to AAC.
  - Anything else (10-bit or HDR, larger than 1080p, rotated, or a codec the player cannot play) is re-encoded to H.264, with a hardware encoder when one is available (NVENC, AMF, Quick Sync, or VideoToolbox).

  Exports always re-encode just the clip, so a kept AV1 or HEVC original costs a little extra time per exported minute instead of a full re-encode at import.
- **Clip bin** holds independent, named cuts from one source. Select a cut, drag the range handles, or enter exact in/out times. Click the filmstrip to scrub; **Add clip** starts a cut at the playhead.
- **Output frame** previews the same centered crop used by the renderer: original, portrait 9:16, or square 1:1. Enable the loop control to review just the selection.
- **Transcript.** Every imported video is transcribed automatically once it opens, in the background: its audio goes to Whisper large v3 turbo on your connected OpenRouter or Cloudflare account in 10-minute parts, three at a time, retried on network and rate-limit errors. Each part is kept as it arrives, so an interrupted run resumes where it stopped, and the finished transcript is stored with the project (`media/<id>/transcript.json`). The **Transcript** tab reads and searches it, follows playback, jumps to a clicked word, sets the clip's in and out with Shift+click, corrects misheard words (Edit words), and saves the transcript as text or the whole video's subtitles as .srt; corrections are kept with the project and reach every clip's captions.
- **Captions** are on every clip automatically, cut from the transcript as ClipCheap cuts them: up to two lines of about 32 characters and 3 seconds, paced slightly ahead of the voice, in **Bold** (the spoken word lights up), **Clean**, **Karaoke** (each word fills as it is spoken) or **Pop** (a few words at a time, the spoken one boxed), at the bottom, middle or top, in twelve colours, or **Off**. A line can be changed for one clip only (**Use the transcript's lines** undoes it). Captions follow trims, cut-out pauses and speed, and are burned in on export in Noto Sans (Korean, Japanese, and Chinese in the platform's regional face), with a matching .srt saved beside the clip.
- **Highlight finder** reads the transcript when the video has one, as ClipCheap does: the AI gets the transcript as numbered sentences, proposes clips that hook in the first sentence and end on a payoff, and each pick is fitted to whole sentences of 20 to 60 seconds, starting past an "um", with no two clips sharing speech. Videos without speech or a transcript use nine frames instead.
- **Export clip** renders the selected range to MP4 (H.264 and optional AAC). Choose the destination in the OS save dialog. Completed renders appear under **Exports**.
- **Workspace** changes are saved locally. Media lives under the platform's app-local-data directory for `studio.quikclip.desktop`, in `media/<id>/`; the webview stores cut metadata and export history. Development and packaged origins may have separate workspace metadata.

| Shortcut | Action |
| --- | --- |
| Space | Play or pause |
| ← / → | Step backward / forward one frame |
| I / O | Set in / out at the playhead |
| M | Mute the monitor |
| ? | Show shortcuts |

## Connect an AI provider

In the desktop app, choose **Find highlights → provider → Connect & load models**. Select a vision model and click **Analyze source**. The studio remembers the model for each provider. **Edit connection**, **Refresh models**, and **Forget connection** are available in the same panel.

| Provider | Connection details | Model selection |
| --- | --- | --- |
| Ollama · local | Start Ollama on port `11434`, or enter its local port. Try `ollama pull gemma3:4b`. | Installed models advertising vision; cloud-backed models are excluded. |
| LM Studio · local | Start the server in the Developer tab (normally port `1234`). Enter a server token if authentication is enabled. | Locally served vision LLMs reported by `/api/v1/models`. |
| OpenRouter · cloud | Enter an [OpenRouter API key](https://openrouter.ai/settings/keys). | Live catalog of image-input, text-output chat models. |
| Cloudflare AI Gateway · cloud | Enter your account ID, gateway ID (`default` is supported), and an API token with **Account → Workers AI → Read**. | Discover Workers AI vision models, or choose **Other gateway model** and enter a supported `author/model` ID. See [Cloudflare's routing and billing guide](https://developers.cloudflare.com/ai-gateway/usage/rest-api/). |

Quikclip sends a single nine-frame contact sheet and timestamps to the selected provider, then adds up to three validated cuts to the clip bin. Connecting or refreshing models does not send footage. Local providers use loopback; choosing cloud analysis sends the sampled frames to that service. The source video and audio are not uploaded.

Tokens are stored in Windows Credential Manager, macOS Keychain, or Linux Secret Service. Project storage contains no API keys. `QUIKCLIP_MODEL` is still honored as the initial Ollama preference when that vision model is installed.

## Browser preview

```sh
npm run dev
```

Visit `http://127.0.0.1:1420`. The browser can play the sample, import browser-decodable local files, keep media in IndexedDB, edit cuts, and export WebM with WebCodecs and Mediabunny. YouTube downloads, AI analysis, and native MP4 rendering run in the desktop build.

## Packaging and checks

```sh
npm run tauri build
```

Build on the target OS to produce installers under `src-tauri/target/release/bundle/`. The **Desktop packages** workflow builds Windows x64, macOS, and Linux packages on native runners. These developer packages are unsigned. Media executables are shipped as namespaced Tauri sidecars; sources and notices are documented in [THIRD_PARTY_TOOLS.md](THIRD_PARTY_TOOLS.md). Local AI model weights are managed by your chosen provider.

```sh
npm run build
npx playwright install chromium
npm test
npm run prepare:tools
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

The Playwright suite imports and plays a real video, verifies persisted trims, and encodes a cropped clip. Use `PLAYWRIGHT_CHANNEL=msedge` to test with installed Microsoft Edge. Native tests cover URL validation, range validation, and FFmpeg output duration, frame size, and audio.

On Windows, `node scripts/smoke-windows.mjs` verifies sample playback and native IPC in a packaged debug build using an isolated WebView2 profile.

## Project layout

- `src/` — editing workspace, source monitor, timeline, clip settings, local storage, browser media adapter.
- `src-tauri/src/media.rs` — native file dialogs, URL canonicalization, bounded media subprocesses, import and atomic export.
- `src-tauri/src/ai.rs`, `providers.rs` — contact sheet extraction, provider discovery and inference, native credential storage, and suggestion validation.
- `src-tauri/src/jobs.rs` — single active media job, asynchronous dispatch and cancellation.
- `public/sample/` — bundled, offline sample film. Credits in [CREDITS.md](CREDITS.md).

## Contribute

Bug reports, patches, and feedback from editors on all three platforms are welcome. Start with the [contributing guide](CONTRIBUTING.md), [report a bug or propose a feature](https://github.com/kerjakuyco/quikclip/issues/new/choose), or read the [security reporting policy](SECURITY.md).

## Support Quikclip

If Quikclip is useful to you, [sponsor **@kerjakuyco** on GitHub](https://github.com/sponsors/kerjakuyco) to support its ongoing development. Sharing a reproducible issue or testing a build on your platform also helps.

## License

Quikclip's source code is licensed under the [GNU General Public License v3.0](LICENSE). See [credits](CREDITS.md) for the licenses of sample media, icons, and fonts.
