// Build para macOS desde Linux: electron-builder (dir) → firma ad-hoc con rcodesign → zip.
const { execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..'); const RCS = process.env.RCODESIGN || 'rcodesign'; // https://github.com/indygreg/apple-platform-rs (opcional)
const arches = (process.env.ARCHES || 'arm64,x64').split(',');
const ver = require('../package.json').version;
execFileSync(process.execPath, [path.join(__dirname, 'fetch-ffmpeg.js'), ...arches.map(a => `darwin-${a}`)], { stdio: 'inherit' });
for (const arch of arches) {
  console.log(`\n=== ${arch} ===`);
  fs.mkdirSync(path.join(root, `staging/bin-${arch}`), { recursive: true });
  fs.copyFileSync(path.join(root, `vendor-bin/ffmpeg-darwin-${arch}`), path.join(root, `staging/bin-${arch}/ffmpeg`));
  execFileSync(path.join(root, 'node_modules/.bin/electron-builder'), ['--mac', 'dir', `--${arch}`], { cwd: root, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  const dir = path.join(root, 'dist', arch === 'x64' ? 'mac' : `mac-${arch}`);
  const app = path.join(dir, 'Subtitulador.app');
  fs.chmodSync(path.join(app, 'Contents/Resources/bin/ffmpeg'), 0o755);
  let hasRcs = true; try { execFileSync(RCS, ['--version'], { stdio: 'ignore' }); } catch { hasRcs = false; }
  if (hasRcs) {
    // firma ad-hoc (sin Apple ID): necesaria para que Apple Silicon ejecute los binarios
    execFileSync(RCS, ['sign', app], { stdio: 'inherit' });
  } else console.warn('rcodesign no encontrado: el .app queda sin firma ad-hoc');
  const zip = path.join(root, 'dist', `Subtitulador-${ver}-mac-${arch}.zip`);
  execFileSync('python3', [path.join(__dirname, 'zipapp.py'), app, zip], { stdio: 'inherit' });
}
