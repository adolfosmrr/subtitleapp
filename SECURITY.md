# Security Policy

## Supported versions
Only the latest release receives fixes.

## Reporting a vulnerability
Please **do not open a public issue**. Report it privately through GitHub:
**[Security › Report a vulnerability](https://github.com/adolfosmrr/subtitulador/security/advisories/new)**.

Include the version, macOS version, steps to reproduce and, if possible, a sample file. You will get an answer as soon as possible; once a fix is released the advisory will be published with credit, if you want it.

## Trusted downloads
- The only official downloads are the zips attached to **[GitHub Releases](https://github.com/adolfosmrr/subtitulador/releases)** of `adolfosmrr/subtitulador`. Copies hosted anywhere else are not supported.
- Each release includes `SHA256SUMS.txt`. Check your download with `shasum -a 256 <file>.zip` before opening it.
- Subtitulador has no auto-updater and no telemetry. It only connects to `huggingface.co` to download the speech and translation models, pinned to fixed revisions.
- The app is ad-hoc signed, not notarized by Apple. macOS will ask for confirmation the first time; that is expected. A zip whose checksum doesn't match the published one must not be opened.

## Scope
In scope: the app code in this repository and the release zips. Out of scope: third-party components (Electron, ffmpeg, transformers.js, ONNX Runtime, models), which should be reported upstream, unless the problem comes from how Subtitulador uses them.
