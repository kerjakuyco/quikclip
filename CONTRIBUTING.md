# Contributing to Quikclip

The fastest way to get familiar with Quikclip is to open the sample project, trim a clip, change its output frame, and export it. No model download is needed for this workflow.

## Start a change

1. Check the [issue tracker](https://github.com/kerjakuyco/quikclip/issues) for existing work. For a large change, open a feature request first so we can discuss the editing workflow.
2. Fork the repository and create a branch from `main`.
3. Follow the [desktop setup instructions](README.md#run-the-desktop-app) in your fork. For UI-only work, `npm ci` and `npm run dev` start the browser preview.

## Where to work

| Area | Location |
| --- | --- |
| Workspace and project state | `src/App.tsx`, `src/studio.ts` |
| Timeline, clip settings, dialogs | `src/components/` |
| Native media import and export | `src-tauri/src/media.rs` |
| Local AI and job cancellation | `src-tauri/src/ai.rs`, `src-tauri/src/jobs.rs` |
| End-to-end editor workflows | `tests/` |

Keep media processing off the UI thread. When changing a trim or crop behavior, compare the preview with an actual exported clip. For UI changes, check keyboard navigation as well as the pointer interaction.

## Verify and submit

```sh
npm run format:check
npm run build
npx playwright install chromium
npm test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

The native media tests require `ffmpeg` and `ffprobe` on `PATH`. For tests on Windows you can use the installed Edge browser by setting `PLAYWRIGHT_CHANNEL=msedge`. YouTube and Ollama are optional for the test suite.

In your pull request, explain what changed for the editor, the OS you tested, and how to reproduce or verify the result. A screenshot or short recording is particularly helpful for timeline and layout changes. Use the bundled sample or media you have permission to share.

Contributions are made under the project's [GPL v3 license](LICENSE). Our [code of conduct](CODE_OF_CONDUCT.md) applies to project discussions and reviews.
