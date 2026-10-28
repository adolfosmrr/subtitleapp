const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const samples = path.join(root, 'test/samples');
const mode = process.argv[2] || 'pipeline';

function pipelineConfig(out) {
  const model = process.env.MODEL || 'base';
  const mw = process.env.MAXWORDS ? +process.env.MAXWORDS : undefined;
  const jobs = [
    { input: path.join(samples, 'en.mp4'), lang: 'auto', model, style: 'Clásico (borde negro)', out: path.join(out, 'en'), tab: 'subs', maxWords: mw },
    { input: path.join(samples, 'es.mp4'), lang: 'auto', model, style: 'Redes (amarillo grande)', out: path.join(out, 'es'), tab: mw ? 'subs' : 'style', maxWords: mw },
    { input: path.join(samples, 'es.mp4'), lang: 'es', model, style: 'Caja oscura', out: path.join(out, 'box'), tab: 'export', drag: [-150, -260], codec: process.env.CODEC },
  ];
  return { device: process.env.DEVICE || 'auto', jobs: process.env.ONLY ? jobs.filter(j => j.out.endsWith(process.env.ONLY)) : jobs };
}

function compareConfig(out) {
  const base = { fontFamily: 'Poppins', fontSize: 6.5, maxWidth: 45, shadow: true, shadowOffset: 0.6, shadowOpacity: 0.9, shadowColor: '#000000' };
  const dirs = ['p', 'moved/proj', 'moved/media'].map(d => path.join(out, d));
  dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));
  fs.copyFileSync(path.join(samples, 'en.mp4'), path.join(out, 'moved/media/clip.mp4'));
  const pj = { app: 'Subtitulador', format: 1, media: { path: '/no/existe/clip.mp4', relPath: '../media/clip.mp4' }, segs: [{ id: 'x', start: 0, end: 2, text: 'hola' }], style: {}, settings: {} };
  fs.writeFileSync(path.join(out, 'moved/proj/test.subtitulador'), JSON.stringify(pj));
  fs.writeFileSync(path.join(out, 'lost.subtitulador'), JSON.stringify({ ...pj, media: { path: '/no/existe/clip.mp4', relPath: 'nada/clip.mp4' }, style: { lineHeight: 1.4, fontFamily: 'X,{\\b1}' }, segs: [{ id: '<img src=x onerror=alert(1)>', start: 0, end: 2, text: '<b>hola</b>{\\fs300}' }] }).replace('"style":{', '"style":{"__proto__":{"polluted":true},').replace('"settings":{}', '"settings":{"__proto__":{"polluted":true},"model":"evil/model"}'));
  const variants = process.env.NOVAR ? [{ name: 'menu', style: { lineHeight: 1.3, shadowType: 'blur' } }] : [
    { name: 'lh10', style: { ...base, lineHeight: 1.0 } },
    { name: 'lh16', style: { ...base, lineHeight: 1.6 } },
    { name: 'solid', style: { ...base, lineHeight: 1.1, outlineWidth: 0, shadowType: 'solid', shadowOffset: 0.8 } },
    { name: 'blur', style: { ...base, lineHeight: 1.1, outlineWidth: 0, shadowType: 'blur', shadowOffset: 0.8, shadowBlur: 0.8 } },
    { name: 'boxtop', style: { ...base, lineHeight: 1.6, box: true, position: 'top' } },
  ];
  return { compare: { input: path.join(samples, 'en.mp4'), out: out + path.sep, text: 'Había una vez una abeja que no quería trabajar nada', overlays: true, uiShots: true, features: true, shots: path.join(root, 'shots') + path.sep,
    project: path.join(out, 'p/test.subtitulador'), projMoved: path.join(out, 'moved/proj/test.subtitulador'), projLost: path.join(out, 'lost.subtitulador'), variants } };
}

const out = path.join(root, 'test/out', mode === 'compare' ? 'cmp' : '');
fs.mkdirSync(out, { recursive: true });
const cfgFile = path.join(out, 'cfg.json');
fs.writeFileSync(cfgFile, JSON.stringify(mode === 'compare' ? compareConfig(out) : pipelineConfig(out)));
const env = { ...process.env, SUBT_SELFTEST: cfgFile, ...(mode === 'compare' ? { SUBT_DISABLE_GPU: '1' } : {}) };
const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', path.join(root, 'node_modules/.bin/electron'), '--no-sandbox', root], { env, encoding: 'utf8', timeout: 3600e3, maxBuffer: 256 * 1024 * 1024 });
const lines = `${r.stdout}\n${r.stderr}`.split('\n').filter(l => l.includes('SELFTEST') || /error/i.test(l));
fs.writeFileSync(path.join(out, 'log.txt'), lines.join('\n'));
console.log(lines.join('\n'));
const ok = lines.some(l => l.startsWith('SELFTEST_RESULT {"ok":true'));
process.exit(ok ? 0 : 1);
