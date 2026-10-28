// Prueba los 3 códecs de exportación con el ASS generado por la app (ffmpeg Linux).
const ff = require('../src/lib/ffmpeg'); const fs = require('fs'), path = require('path'), os = require('os');
(async () => {
  const root = path.join(__dirname, '..'); const input = path.join(root, 'test/samples/es.mp4');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'st-')); fs.cpSync(path.join(root, 'fonts'), path.join(tmp, 'fonts'), { recursive: true });
  fs.copyFileSync(path.join(root, 'test/out/es.ass'), path.join(tmp, 'subs.ass'));
  const info = await ff.probe(input);
  for (const codec of ['hevc', 'prores']) {
    const output = path.join(root, `test/out/es-${codec}.${codec === 'prores' ? 'mov' : 'mp4'}`);
    const t = Date.now(); const r = await ff.run(ff.burnArgs({ input, output, assFile: 'subs.ass', fontsDir: 'fonts', codec, info }), { cwd: tmp });
    const o = await ff.probe(output);
    console.log(codec, r.code, ((Date.now() - t) / 1000).toFixed(1) + 's', o.width + 'x' + o.height, o.fps, o.vcodec, o.pixfmt, o.acodec, (fs.statSync(output).size / 1e6).toFixed(1) + 'MB');
  }
})();
