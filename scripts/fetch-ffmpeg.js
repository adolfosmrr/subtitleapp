// Descarga los binarios estáticos de ffmpeg (ffmpeg-static b6.0) a vendor-bin/ y verifica su SHA-256.
// Uso: node scripts/fetch-ffmpeg.js [darwin-arm64 darwin-x64 linux-x64]   (sin args: la plataforma actual + ambas de mac)
const fs = require('fs'); const path = require('path'); const zlib = require('zlib'); const crypto = require('crypto');
const BASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/';
const SHA = {
  'darwin-arm64': 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
  'darwin-x64': 'cfe20936c83ecf5d68e424b87e8cc45b24dd6be81787810123bb964a0df686f9',
  'linux-x64': 'ed652b2f32e0851d1946894fb8333f5b677c1b2ce6b9d187910a67f8b99da028',
};
const dir = path.join(__dirname, '..', 'vendor-bin'); fs.mkdirSync(dir, { recursive: true });
const want = process.argv.slice(2).length ? process.argv.slice(2) : [...new Set([`${process.platform}-${process.arch}`, 'darwin-arm64', 'darwin-x64'])].filter(k => SHA[k]);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
(async () => {
  for (const k of want) {
    const out = path.join(dir, `ffmpeg-${k}`);
    if (fs.existsSync(out) && sha(fs.readFileSync(out)) === SHA[k]) { console.log(`ffmpeg-${k}: ok`); continue; }
    console.log(`descargando ffmpeg-${k}…`);
    const r = await fetch(`${BASE}ffmpeg-${k}.gz`); if (!r.ok) throw new Error(`HTTP ${r.status} para ${k}`);
    const bin = zlib.gunzipSync(Buffer.from(await r.arrayBuffer()));
    if (sha(bin) !== SHA[k]) throw new Error(`SHA-256 no coincide para ffmpeg-${k}`);
    fs.writeFileSync(out, bin); fs.chmodSync(out, 0o755); console.log(`ffmpeg-${k}: descargado y verificado`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
