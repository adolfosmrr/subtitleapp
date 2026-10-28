// Utilidades ffmpeg (proceso principal). Sin módulos nativos.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function binPath() {
  if (process.env.SUBT_FFMPEG) return process.env.SUBT_FFMPEG;
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  // empaquetado: Contents/Resources/bin/ffmpeg ; desarrollo: vendor-bin/ffmpeg-<plat>-<arch>
  const packed = process.resourcesPath ? path.join(process.resourcesPath, 'bin', name) : null;
  if (packed && fs.existsSync(packed)) return packed;
  const dev = path.join(__dirname, '..', '..', 'vendor-bin', `ffmpeg-${process.platform}-${process.arch}`);
  if (fs.existsSync(dev)) return dev;
  return 'ffmpeg';
}

function run(args, { onStderr, cwd, signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(binPath(), args, { cwd });
    const out = []; let err = '';
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => { const s = d.toString(); err += s; if (err.length > 200000) err = err.slice(-100000); onStderr && onStderr(s); });
    if (signal) signal.addEventListener('abort', () => p.kill('SIGKILL'));
    p.on('error', reject);
    p.on('close', code => resolve({ code, stdout: Buffer.concat(out), stderr: err }));
  });
}

// Lee resolución, fps, duración y códecs parseando `ffmpeg -i` (no hace falta ffprobe).
async function probe(file) {
  const { stderr } = await run(['-hide_banner', '-i', file]);
  const info = { file, duration: 0, width: 0, height: 0, fps: 0, vcodec: null, acodec: null, pixfmt: null, hasVideo: false, hasAudio: false };
  const d = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (d) info.duration = +d[1] * 3600 + +d[2] * 60 + +d[3];
  const v = stderr.split('\n').find(l => /Stream #.*Video:/.test(l) && !/attached pic/.test(l));
  if (v) {
    info.hasVideo = true;
    info.vcodec = (v.match(/Video: (\w+)/) || [])[1];
    const pf = v.match(/Video: [^,]+(?:\([^)]*\))?[^,]*, (\w+)/); info.pixfmt = pf ? pf[1] : null;
    const r = v.match(/, (\d{2,5})x(\d{2,5})/); if (r) { info.width = +r[1]; info.height = +r[2]; }
    const f = v.match(/([\d.]+) fps/) || v.match(/([\d.]+) tbr/); if (f) info.fps = +f[1];
    const rot = stderr.match(/rotation of (-?\d+(?:\.\d+)?)/) || stderr.match(/rotate\s*:\s*(-?\d+)/);
    if (rot && Math.abs(Math.round(+rot[1])) % 180 === 90) [info.width, info.height] = [info.height, info.width];
  }
  const a = stderr.match(/Stream #.*Audio: (\w+)/);
  if (a) { info.hasAudio = true; info.acodec = a[1]; }
  return info;
}

// PCM float32 mono 16 kHz para Whisper
async function extractAudio(file) {
  const { code, stdout, stderr } = await run(['-hide_banner', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1']);
  if (code !== 0) throw new Error('ffmpeg no pudo extraer el audio: ' + stderr.slice(-400));
  return stdout;
}

const MP4_AUDIO_OK = new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac', 'opus', 'flac']);

// opts: { input, output, assFile (nombre relativo en cwd), fontsDir (relativo), codec: h264|hevc|prores, crf, preset, info }
function burnArgs(o) {
  const info = o.info || {};
  const vf = `ass=${o.assFile}:fontsdir=${o.fontsDir}`;
  const args = ['-hide_banner', '-nostdin', '-y', '-i', o.input, '-map', '0:v:0', '-map', '0:a?', '-vf', vf, '-fps_mode', 'passthrough'];
  const tenBit = /10le|10be|p010/.test(info.pixfmt || '');
  if (o.codec === 'prores') {
    args.push('-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le');
    args.push('-c:a', 'pcm_s16le');
  } else if (o.codec === 'hevc') {
    args.push('-c:v', 'libx265', '-preset', o.preset || 'slow', '-crf', String(o.crf ?? 16), '-pix_fmt', tenBit ? 'yuv420p10le' : 'yuv420p', '-tag:v', 'hvc1');
    args.push(...audioArgs(info));
  } else {
    args.push('-c:v', 'libx264', '-preset', o.preset || 'slow', '-crf', String(o.crf ?? 15), '-pix_fmt', 'yuv420p', '-profile:v', 'high');
    args.push(...audioArgs(info));
  }
  if (o.codec !== 'prores') args.push('-movflags', '+faststart');
  args.push(o.output);
  return args;
}
function audioArgs(info) {
  if (!info.hasAudio) return [];
  return MP4_AUDIO_OK.has(info.acodec) ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '320k'];
}

// fps decimal → racional exacto para lavfi (29.97 → 30000/1001)
function fpsRational(f) {
  if (!f) return '30';
  for (const b of [24, 30, 48, 60, 120]) if (Math.abs(f - b * 1000 / 1001) < 0.01) return `${b * 1000}/1001`;
  return String(Math.round(f * 1000) / 1000);
}
// Video SOLO con subtítulos (misma resolución/fps/duración que el original).
// mode: 'alpha' → ProRes 4444 con canal alfa (.mov); 'green' | 'black' → H.264 sobre fondo sólido (.mp4)
function overlayArgs(o) {
  const { width: W, height: H, fps, duration } = o.info; const r = fpsRational(fps); const d = Math.max(0.04, duration || 1).toFixed(3);
  const ass = `ass=${o.assFile}:fontsdir=${o.fontsDir}`;
  if (o.mode === 'alpha') return ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', `color=c=black@0.0:s=${W}x${H}:r=${r}:d=${d},format=rgba`,
    '-vf', `${ass}:alpha=1,format=yuva444p10le`, '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0', o.output];
  const c = o.mode === 'green' ? '0x00FF00' : 'black';
  return ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', `color=c=${c}:s=${W}x${H}:r=${r}:d=${d}`, '-vf', `${ass},format=yuv420p`,
    '-c:v', 'libx264', '-crf', '15', '-preset', 'medium', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', o.output];
}
module.exports = { binPath, run, probe, extractAudio, burnArgs, overlayArgs, fpsRational };
