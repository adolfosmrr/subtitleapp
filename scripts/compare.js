const { spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..'); const out = path.join(root, 'test/out/cmp/'); fs.mkdirSync(out, { recursive: true });
const base = { fontFamily: 'Poppins', fontSize: 6.5, maxWidth: 45, shadow: true, shadowOffset: 0.6, shadowOpacity: 0.9, shadowColor: '#000000' };
const cfg = { compare: { input: path.join(root, 'test/samples/en.mp4'), out, text: 'Había una vez una abeja que no quería trabajar nada',
  overlays: true, uiShots: true, project: out + 'p/test.subtitulador', projMoved: out + 'moved/proj/test.subtitulador', projLost: out + 'lost.subtitulador',
  variants: process.env.NOVAR ? [{ name: 'menu', style: { lineHeight: 1.3, shadowType: 'blur' } }] : [
    { name: 'lh10', style: { ...base, lineHeight: 1.0 } },
    { name: 'lh16', style: { ...base, lineHeight: 1.6 } },
    { name: 'solid', style: { ...base, lineHeight: 1.1, outlineWidth: 0, shadowType: 'solid', shadowOffset: 0.8 } },
    { name: 'blur', style: { ...base, lineHeight: 1.1, outlineWidth: 0, shadowType: 'blur', shadowOffset: 0.8, shadowBlur: 0.8 } },
    { name: 'boxtop', style: { ...base, lineHeight: 1.6, box: true, position: 'top' } },
  ] } };
fs.mkdirSync(out + 'p', { recursive: true }); fs.mkdirSync(out + 'moved/proj', { recursive: true }); fs.mkdirSync(out + 'moved/media', { recursive: true });
fs.copyFileSync(path.join(root, 'test/samples/en.mp4'), out + 'moved/media/clip.mp4');
const pj = { app: 'Subtitulador', format: 1, media: { path: '/no/existe/clip.mp4', relPath: '../media/clip.mp4' }, segs: [{ id: 'x', start: 0, end: 2, text: 'hola' }], style: {}, settings: {} };
fs.writeFileSync(out + 'moved/proj/test.subtitulador', JSON.stringify(pj));
fs.writeFileSync(out + 'lost.subtitulador', JSON.stringify({ ...pj, media: { path: '/no/existe/clip.mp4', relPath: 'nada/clip.mp4' }, style: { lineHeight: 1.4 } }));
fs.writeFileSync(out + 'cfg.json', JSON.stringify(cfg));
const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', path.join(root, 'node_modules/.bin/electron'), '--no-sandbox', root],
  { env: { ...process.env, SUBT_SELFTEST: out + 'cfg.json', SUBT_DISABLE_GPU: '1' }, encoding: 'utf8', timeout: 900e3 });
const lines = (r.stdout + r.stderr).split('\n').filter(l => l.includes('SELFTEST') || /error/i.test(l));
console.log(lines.join('\n')); fs.writeFileSync(out + 'log.txt', lines.join('\n'));
