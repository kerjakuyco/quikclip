# Sample media and UI assets

*Alpine field notes* is a 36-second sample assembled from these [Unsplash](https://unsplash.com/license) photographs:

- [Sunlit ridge above the clouds](https://images.unsplash.com/photo-1506905925346-21bda4d32df4)
- [Mountain valley and glacier](https://images.unsplash.com/photo-1464822759023-fed622ff2c3b)
- [Lakeside landscape](https://images.unsplash.com/photo-1470770841072-f978cf4d019e)

The sample includes motion, titles, and a synthesized ambient soundtrack. `scripts/make_sample.py` rebuilds the film from the three JPEGs using Pillow, FFmpeg and local fonts. Set `SAMPLE_SERIF` and `SAMPLE_SANS` to suitable font file paths on other operating systems.

Interface icons: Lucide (ISC). Interface font: Manrope (SIL Open Font License), self-hosted through Fontsource. Caption faces: Noto Sans, Montserrat, Poppins, Bebas Neue, and Anton (SIL Open Font License), bundled in `public/fonts` with their licenses. Source photos and third-party assets retain their respective licenses.

## Test fixtures

`src-tauri/tests/assets/portrait.jpg` is NASA's official 1969 portrait of Neil Armstrong (S69-31741), a work of the United States government in the public domain, from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Neil_Armstrong_pose.jpg). It checks the bundled face detector against a real face. Face detection uses the SeetaFace frontal model under the BSD 2-Clause License; see [THIRD_PARTY_TOOLS.md](THIRD_PARTY_TOOLS.md).
