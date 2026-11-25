# Bundled desktop media tools

Quikclip distributes the following unmodified standalone programs. Exact download URLs and SHA-256 digests for each platform are in `scripts/tools.lock.json` in the Quikclip source. They run as separate processes.

- **yt-dlp** — [2026.11.23 source and release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.11.23). The official standalone executables include Python and the matching yt-dlp EJS components. See the [upstream license and binary distribution notices](https://github.com/yt-dlp/yt-dlp#license); the standalone builds include GPLv3+ code.
- **FFmpeg and ffprobe** — version 6.1.1. On Windows, `ffmpeg` is the gyan.dev full build ([release and archive](https://github.com/GyanD/codexffmpeg/releases/tag/6.1.1), which includes the dav1d AV1 decoder); every other binary comes from the [ffmpeg-static b6.1.1 distribution, sources and build information](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1). The platform-specific upstream license and source/build notes accompany the installed app in `notices/ffmpeg.LICENSE` and `notices/ffmpeg.README`.
- **QuickJS-NG** — [v0.18.0 release and corresponding source](https://github.com/quickjs-ng/quickjs/releases/tag/v0.18.0). The MIT license text is included with this app; see also the [upstream license](https://github.com/quickjs-ng/quickjs/blob/v0.18.0/LICENSE).

## Noto Sans — SIL Open Font License 1.1

Captions are set in Noto Sans Regular and Bold (`public/fonts`, from [notofonts.github.io at d14cc17](https://github.com/notofonts/notofonts.github.io/tree/d14cc173a70dc57962ed2d4ad278fc9df83bf9f3/fonts/NotoSans/hinted/ttf)), unmodified. Copyright 2022 The Noto Project Authors. The license text accompanies the fonts in `fonts/OFL.txt`.

## QuickJS-NG — MIT License

```text
Copyright (c) 2017-2026 Fabrice Bellard
Copyright (c) 2017-2024 Charlie Gordon
Copyright (c) 2023-2026 Ben Noordhuis
Copyright (c) 2023-2026 Saúl Ibarra Corretgé
```

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
