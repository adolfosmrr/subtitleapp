const { app, BrowserWindow, ipcMain, dialog, protocol, shell, net, Menu } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ff = require('./lib/ffmpeg');
const I18N = require('./lib/i18n'); const t = I18N.t;
I18N.setLang(I18N.systemLang(((readStoreEarly().settings || {}).uiLang && readStoreEarly().settings.uiLang !== 'auto') ? readStoreEarly().settings.uiLang : (app.getPreferredSystemLanguages?.()[0] || app.getLocale?.() || 'en')));
function readStoreEarly() { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'subtitulador.json'), 'utf8')); } catch { return {}; } }

const RENDERER = path.join(__dirname, 'renderer');
const LIB = path.join(__dirname, 'lib');
const FONTS = app.isPackaged ? path.join(process.resourcesPath, 'fonts') : path.join(__dirname, '..', 'fonts');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.commandLine.appendSwitch('enable-unsafe-webgpu');
if (process.env.SUBT_DISABLE_GPU) app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer,Vulkan');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.otf': 'font/otf', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };
const ISO = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };

async function serveMedia(req, file) {
  const size = (await fs.promises.stat(file)).size;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const m = (req.headers.get('range') || '').match(/bytes=(\d*)-(\d*)/);
  let start = 0, end = size - 1;
  if (m) { start = m[1] ? +m[1] : Math.max(0, size - +m[2]); end = m[1] && m[2] ? +m[2] : size - 1; }
  end = Math.min(end, size - 1);
  if (process.env.SUBT_LOG) console.log('[media]', req.headers.get('range'), start, end, size);
  const body = require('stream').Readable.toWeb(fs.createReadStream(file, { start, end }));
  return new Response(body, { status: m ? 206 : 200, headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
}


function registerProtocol() {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    try {
      if (p === '/__media') return serveMedia(req, u.searchParams.get('p'));
      let file;
      if (p.startsWith('/lib/')) file = path.join(LIB, p.slice(5));
      else if (p.startsWith('/fonts/')) file = path.join(FONTS, p.slice(7));
      else file = path.join(RENDERER, p === '/' ? 'index.html' : p);
      if (!file.startsWith(RENDERER) && !file.startsWith(LIB) && !file.startsWith(FONTS)) return new Response('no', { status: 403 });
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { ...ISO, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' } });
    } catch (e) { return new Response('404 ' + e.message, { status: 404 }); }
  });
}

// ---- almacenamiento simple (presets + ajustes) ----
const storeFile = () => path.join(app.getPath('userData'), 'subtitulador.json');
function readStore() { try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')); } catch { return {}; } }
function writeStore(s) { fs.mkdirSync(path.dirname(storeFile()), { recursive: true }); fs.writeFileSync(storeFile(), JSON.stringify(s, null, 2)); }

let win; let currentExport = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700, backgroundColor: '#0f1115', title: 'Subtitulador',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.webContents.session.setPermissionRequestHandler((wc, perm, cb) => cb(true));
  win.webContents.session.setPermissionCheckHandler(() => true);
  win.loadURL('app://app/index.html');
  if (process.env.SUBT_DEVTOOLS) win.webContents.openDevTools();
  win.webContents.on('console-message', (e, level, msg) => { if (process.env.SUBT_SELFTEST || process.env.SUBT_LOG) console.log('[renderer]', msg); });
}

ipcMain.handle('dialog:openMedia', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: t('Video o audio'), extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:openSubs', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: t('Subtítulos'), extensions: ['srt'] }] });
  return r.canceled ? null : fs.readFileSync(r.filePaths[0], 'utf8');
});
ipcMain.handle('dialog:save', async (e, { defaultPath, filters }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath, filters });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('file:write', (e, p, text) => { fs.writeFileSync(p, text, 'utf8'); return true; });
ipcMain.handle('media:probe', (e, p) => ff.probe(p));
ipcMain.handle('media:audio', async (e, p) => { const b = await ff.extractAudio(p); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); });
ipcMain.handle('store:get', () => readStore());
ipcMain.handle('store:set', (e, s) => { writeStore(s); return true; });
ipcMain.handle('shell:reveal', (e, p) => shell.showItemInFolder(p));
ipcMain.handle('test:config', () => process.env.SUBT_SELFTEST ? JSON.parse(fs.readFileSync(process.env.SUBT_SELFTEST, 'utf8')) : null);
ipcMain.handle('test:shot', async (e, p) => { const img = await win.webContents.capturePage(); fs.writeFileSync(p, img.toPNG()); return p; });
ipcMain.handle('test:menu', async (e, out) => {
  const m = Menu.getApplicationMenu().items.find(i => i.label === t('Archivo'));
  win.setBounds({ x: 0, y: 0, width: 1000, height: 620 }); win.focus(); await new Promise(r => setTimeout(r, 600));
  m.submenu.popup({ window: win, x: 20, y: 40 }); await new Promise(r => setTimeout(r, 900));
  const r = require('child_process').spawnSync('python3', ['-c', `from PIL import ImageGrab; import os; ImageGrab.grab(xdisplay=os.environ["DISPLAY"]).save(${JSON.stringify(out)})`], { encoding: 'utf8' });
  m.submenu.closePopup(win); return r.status === 0 ? out : r.stderr;
});
ipcMain.handle('test:done', (e, result) => { console.log('SELFTEST_RESULT ' + JSON.stringify(result)); setTimeout(() => app.exit(result && result.ok ? 0 : 1), 300); });

// fonts: [{file, data(Uint8Array)}] fuentes del sistema elegidas, se copian junto a las incluidas
ipcMain.handle('export:burn', async (e, job) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitulador-'));
  const fdir = path.join(tmp, 'fonts'); fs.mkdirSync(fdir);
  for (const f of fs.readdirSync(FONTS).filter(f => /\.(ttf|otf)$/i.test(f))) fs.copyFileSync(path.join(FONTS, f), path.join(fdir, f));
  for (const f of job.fonts || []) fs.writeFileSync(path.join(fdir, f.file), Buffer.from(f.data));
  fs.writeFileSync(path.join(tmp, 'subs.ass'), job.ass, 'utf8');
  const info = await ff.probe(job.input);
  const args = job.overlay ? ff.overlayArgs({ output: job.output, assFile: 'subs.ass', fontsDir: 'fonts', mode: job.overlay, info })
    : ff.burnArgs({ input: job.input, output: job.output, assFile: 'subs.ass', fontsDir: 'fonts', codec: job.codec, crf: job.crf, preset: job.preset, info });
  const ac = new AbortController(); currentExport = ac;
  const t0 = Date.now();
  const r = await ff.run(args, { cwd: tmp, signal: ac.signal, onStderr: s => {
    const m = s.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m && info.duration) e.sender.send('export:progress', Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / info.duration));
  } });
  currentExport = null;
  fs.rmSync(tmp, { recursive: true, force: true });
  if (r.code !== 0) return { ok: false, error: ac.signal.aborted ? 'Cancelado' : r.stderr.slice(-1500), args };
  const out = await ff.probe(job.output);
  return { ok: true, seconds: (Date.now() - t0) / 1000, in: info, out, args };
});
ipcMain.handle('export:cancel', () => { currentExport && currentExport.abort(); });

// ---- proyectos (.subtitulador) ----
let pendingOpen = process.argv.slice(1).find(a => a.endsWith('.subtitulador') && fs.existsSync(a)) || null; let rendererReady = false;
let dirty = false; let forceClose = false;
function openProjectPath(p) { if (!p) return; if (win && rendererReady) { win.webContents.send('project:open', p); win.show(); } else pendingOpen = p; }
app.on('open-file', (e, p) => { e.preventDefault(); openProjectPath(p); });
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit(); else app.on('second-instance', (e, argv) => { const p = argv.find(a => a.endsWith('.subtitulador')); if (p) openProjectPath(p); });
function recents() { return (readStore().recents || []).filter(p => fs.existsSync(p)); }
function addRecent(p) { const s = readStore(); s.recents = [p, ...(s.recents || []).filter(x => x !== p)].slice(0, 10); writeStore(s); if (process.platform === 'darwin') app.addRecentDocument(p); buildMenu(); }
const send = (c, ...a) => win && win.webContents.send(c, ...a);
function buildMenu() {
  const rec = recents();
  const tpl = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: t('Archivo'), submenu: [
      { label: t('Nuevo proyecto'), accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
      { label: t('Abrir proyecto…'), accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open') },
      { label: t('Abrir recientes'), submenu: rec.length ? [...rec.map(p => ({ label: path.basename(p), sublabel: p, click: () => openProjectPath(p) })), { type: 'separator' },
        { label: t('Borrar lista'), click: () => { const s = readStore(); s.recents = []; writeStore(s); app.clearRecentDocuments?.(); buildMenu(); } }] : [{ label: t('(vacío)'), enabled: false }] },
      { type: 'separator' },
      { label: t('Guardar'), accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
      { label: t('Guardar como…'), accelerator: 'Shift+CmdOrCtrl+S', click: () => send('menu', 'saveAs') },
      { type: 'separator' },
      { label: t('Importar video o audio…'), click: () => send('menu', 'media') },
      ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit', label: t('Salir') }]),
    ] },
    { label: t('Idioma'), submenu: [['es', 'Español'], ['en', 'English']].map(([l, n]) => ({ label: n, type: 'radio', checked: I18N.getLang() === l, click: () => send('menu', 'lang:' + l) })) },
    { role: 'editMenu', label: t('Edición') }, { role: 'viewMenu', label: t('Ver') }, { role: 'windowMenu', label: t('Ventana') },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}
ipcMain.handle('ui:lang', (e, l) => { if (l !== I18N.getLang()) { I18N.setLang(l); buildMenu(); } });
ipcMain.handle('project:ready', () => { rendererReady = true; const p = pendingOpen; pendingOpen = null; return p; });
ipcMain.handle('project:dirty', (e, d, title) => { dirty = !!d; if (win) { win.setDocumentEdited?.(dirty); win.setTitle(title || 'Subtitulador'); } });
ipcMain.handle('project:read', (e, p) => {
  const d = JSON.parse(fs.readFileSync(p, 'utf8')); const m = d.media || {};
  const rel = m.relPath ? path.resolve(path.dirname(p), m.relPath) : null;
  m.resolved = m.path && fs.existsSync(m.path) ? m.path : rel && fs.existsSync(rel) ? rel : null; d.media = m; return d;
});
ipcMain.handle('project:write', (e, p, data) => { if (data.media && data.media.path) data.media.relPath = path.relative(path.dirname(p), data.media.path); fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8'); addRecent(p); return true; });
ipcMain.handle('project:added', (e, p) => addRecent(p));
ipcMain.handle('dialog:openProject', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: t('Proyecto Subtitulador'), extensions: ['subtitulador'] }] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('fs:exists', (e, p) => !!p && fs.existsSync(p));
ipcMain.handle('dialog:confirm', async (e, o) => (await dialog.showMessageBox(win, { type: 'question', buttons: o.buttons, defaultId: 0, cancelId: o.cancelId ?? o.buttons.length - 1, message: o.message, detail: o.detail })).response);
ipcMain.handle('app:closeNow', () => { forceClose = true; win && win.close(); });

app.whenReady().then(() => {
  registerProtocol(); buildMenu(); createWindow();
  win.on('close', (e) => { if (dirty && !forceClose && !process.env.SUBT_SELFTEST) { e.preventDefault(); send('menu', 'close'); } });
});
app.on('window-all-closed', () => app.quit());
