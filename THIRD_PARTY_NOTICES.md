# Third-party notices

Subtitulador's own source code is MIT-licensed (see `LICENSE`). The app bundles or downloads the following third-party components, each under its own license.

## FFmpeg (bundled binary — GPL)
- The macOS app ships a static `ffmpeg` 6.0 executable (from the [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) release `b6.0`; macOS builds originally by [evermeet.cx](https://evermeet.cx/ffmpeg/) (x64) and [osxexperts.net](https://www.osxexperts.net/) (arm64)).
- It is built with `--enable-gpl --enable-version3` and includes libx264, libx265, libass, freetype, etc., so **that binary is licensed under the GNU GPL v3**. It runs as a separate program (Subtitulador calls it as a command-line process); it is not linked into Subtitulador's code.
- FFmpeg source code: <https://ffmpeg.org/releases/ffmpeg-6.0.tar.xz> (and <https://git.ffmpeg.org/ffmpeg.git>, tag `n6.0`). License: <https://ffmpeg.org/legal.html>. GPL v3 text: <https://www.gnu.org/licenses/gpl-3.0.txt>.
- `scripts/fetch-ffmpeg.js` downloads the exact binaries used (verified by SHA-256).

## Electron
- [Electron](https://github.com/electron/electron) — MIT License. Electron includes Chromium and Node.js, under their own licenses (BSD-style, MIT and others); see `LICENSES.chromium.html` inside the app bundle.

## Transformers.js and ONNX Runtime Web
- [@huggingface/transformers](https://github.com/huggingface/transformers.js) (transformers.js) — Apache License 2.0.
- [onnxruntime-web](https://github.com/microsoft/onnxruntime) (WASM files bundled with transformers.js) — MIT License.

## AI models (downloaded on first use, not bundled)
- **Whisper** (OpenAI) — MIT License. <https://github.com/openai/whisper>. ONNX conversions from [onnx-community](https://huggingface.co/onnx-community) (`whisper-tiny/base/small/large-v3-turbo_timestamped`).
- **Opus-MT** (Helsinki-NLP, University of Helsinki) — CC-BY 4.0. <https://huggingface.co/Helsinki-NLP/opus-mt-en-es>, <https://huggingface.co/Helsinki-NLP/opus-mt-es-en>; ONNX conversions by [Xenova](https://huggingface.co/Xenova). Attribution: Jörg Tiedemann and Santhosh Thottingal, "OPUS-MT — Building open translation services for the World", EAMT 2020.

## Fonts (bundled, in `fonts/`)
| Font | License | Copyright |
|---|---|---|
| Poppins | SIL Open Font License 1.1 | The Poppins Project Authors |
| Lato | SIL Open Font License 1.1 | Łukasz Dziedzic |
| Anton | SIL Open Font License 1.1 | The Anton Project Authors |
| Bebas Neue | SIL Open Font License 1.1 | Dharma Type |
| Lobster | SIL Open Font License 1.1 | The Lobster Project Authors |
| Permanent Marker | Apache License 2.0 | Font Diner |

Full license texts are in `fonts/licenses/`. Fonts obtained from [Google Fonts](https://github.com/google/fonts).
