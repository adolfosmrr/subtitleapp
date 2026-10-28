const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const INPUT_FORMATS = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mp3,wav,aac,flac,ogg';
const MP4_AUDIO_OK = new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac', 'opus', 'flac']);
const CODECS = new Set(['h264', 'hevc', 'prores']);
const PRESETS = new Set(['medium', 'slow', 'slower']);
const OVERLAYS = new Set(['alpha', 'green', 'black']);
const ASS_FILTER = 'ass=subs.ass:fontsdir=fonts';

function binPath() {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'bin', name));
  candidates.push(path.join(__dirname, '..', '..', 'vendor-bin', `ffmpeg-${process.platform}-${process.arch}`));
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('ffmpeg no encontrado');
  return found;
}

function run(args, { onStderr, cwd, signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(binPath(), args, { cwd, shell: false, windowsHide: true, env: { PATH: '/usr/bin:/bin', HOME: os.homedir(), TMPDIR: os.tmpdir() } });
    const out = []; let err = '';
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => { const s = d.toString(); err += s; if (err.length > 200000) err = err.slice(-100000); if (onStderr) onStderr(s); });
    if (signal) signal.addEventListener('abort', () => p.kill('SIGKILL'));
    p.on('error', reject);
    p.on('close', code => resolve({ code, stdout: Buffer.concat(out), stderr: err }));
  });
}

function inputArgs(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Ruta inválida');
  return ['-protocol_whitelist', 'file,pipe', '-format_whitelist', INPUT_FORMATS, '-i', 'file:' + file];
}
const outputArg = (file) => {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Ruta inválida');
  return 'file:' + file;
};

async function probe(file) {
  const { stderr } = await run(['-hide_banner', ...inputArgs(file)]);
  const info = { file, duration: 0, width: 0, height: 0, fps: 0, vcodec: null, acodec: null, pixfmt: null, hasVideo: false, hasAudio: false };
  const d = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (d) info.duration = +d[1] * 3600 + +d[2] * 60 + +d[3];
  const v = stderr.split('\n').find(l => /Stream #.*Video:/.test(l) && !/attached pic/.test(l));
  if (v) {
    info.hasVideo = true;
    info.vcodec = (v.match(/Video: (\w+)/) || [])[1] || null;
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

async function extractAudio(file) {
  const { code, stdout, stderr } = await run(['-hide_banner', '-nostdin', ...inputArgs(file), '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1']);
  if (code !== 0) throw new Error('ffmpeg no pudo extraer el audio: ' + stderr.slice(-400));
  return stdout;
}

function audioArgs(info) {
  if (!info.hasAudio) return [];
  return MP4_AUDIO_OK.has(info.acodec) ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '320k'];
}

function burnArgs(o) {
  const info = o.info || {};
  const codec = CODECS.has(o.codec) ? o.codec : 'h264';
  const preset = PRESETS.has(o.preset) ? o.preset : 'slow';
  const crf = Number.isInteger(o.crf) && o.crf >= 0 && o.crf <= 51 ? o.crf : (codec === 'hevc' ? 16 : 15);
  const args = ['-hide_banner', '-nostdin', '-y', ...inputArgs(o.input), '-map', '0:v:0', '-map', '0:a?', '-vf', ASS_FILTER, '-fps_mode', 'passthrough'];
  if (codec === 'prores') {
    args.push('-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s16le');
  } else {
    const tenBit = /10le|10be|p010/.test(info.pixfmt || '');
    if (codec === 'hevc') args.push('-c:v', 'libx265', '-preset', preset, '-crf', String(crf), '-pix_fmt', tenBit ? 'yuv420p10le' : 'yuv420p', '-tag:v', 'hvc1');
    else args.push('-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high');
    args.push(...audioArgs(info), '-movflags', '+faststart');
  }
  args.push(outputArg(o.output));
  return args;
}

function fpsRational(f) {
  if (!(f > 0)) return '30';
  for (const b of [24, 30, 48, 60, 120]) if (Math.abs(f - b * 1000 / 1001) < 0.01) return `${b * 1000}/1001`;
  return String(Math.round(Math.min(f, 240) * 1000) / 1000);
}

function overlayArgs(o) {
  if (!OVERLAYS.has(o.mode)) throw new Error('Modo inválido');
  const W = Math.round(o.info.width), H = Math.round(o.info.height);
  if (!(W > 0 && H > 0 && W <= 16384 && H <= 16384)) throw new Error('Resolución inválida');
  const r = fpsRational(o.info.fps); const d = Math.min(86400, Math.max(0.04, o.info.duration || 1)).toFixed(3);
  const head = ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i'];
  if (o.mode === 'alpha') return [...head, `color=c=black@0.0:s=${W}x${H}:r=${r}:d=${d},format=rgba`,
    '-vf', `${ASS_FILTER}:alpha=1,format=yuva444p10le`, '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0', outputArg(o.output)];
  const c = o.mode === 'green' ? '0x00FF00' : 'black';
  return [...head, `color=c=${c}:s=${W}x${H}:r=${r}:d=${d}`, '-vf', `${ASS_FILTER},format=yuv420p`,
    '-c:v', 'libx264', '-crf', '15', '-preset', 'medium', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputArg(o.output)];
}

module.exports = { run, probe, extractAudio, burnArgs, overlayArgs };
