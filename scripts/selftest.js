// Autotest en Linux: abre la app real bajo xvfb y corre transcribir → traducir → estilo → quemar.
const { spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..'); const out = path.join(root, 'test/out'); fs.mkdirSync(out, { recursive: true });
const model = process.env.MODEL || 'base';
const MW = process.env.MAXWORDS ? +process.env.MAXWORDS : undefined;
const cfg = { device: process.env.DEVICE || 'auto', jobs: [
  { input: path.join(root, 'test/samples/en.mp4'), lang: 'auto', model, style: 'Clásico (borde negro)', out: path.join(out, 'en'), tab: 'subs', maxWords: MW, shot: MW ? path.join(root, 'shots/ui-palabras.png') : undefined },
  { input: path.join(root, 'test/samples/es.mp4'), lang: 'auto', model, style: 'Redes (amarillo grande)', out: path.join(out, 'es'), tab: MW ? 'subs' : 'style', maxWords: MW },
  { input: path.join(root, 'test/samples/es.mp4'), lang: 'es', model, style: 'Caja oscura', out: path.join(out, 'box'), tab: 'export', drag: [-150, -260] },
] };
if (process.env.ONLY) cfg.jobs = cfg.jobs.filter(j => j.out.endsWith(process.env.ONLY));
fs.writeFileSync(path.join(out, 'cfg.json'), JSON.stringify(cfg));
const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', ...(process.env.APP_BIN ? [process.env.APP_BIN, '--no-sandbox'] : [path.join(root, 'node_modules/.bin/electron'), '--no-sandbox', root])],
  { env: { ...process.env, SUBT_SELFTEST: path.join(out, 'cfg.json') }, stdio: 'inherit', timeout: 3600e3 });
process.exit(r.status ?? 1);
