const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ff = require('./lib/ffmpeg');
const I18N = require('./lib/i18n');
const t = I18N.t;

const DEV = !app.isPackaged;
const TEST_CFG = DEV ? process.env.SUBT_SELFTEST || null : null;
const ORIGIN = 'app://app';
const RENDERER = path.join(__dirname, 'renderer');
const LIB = path.join(__dirname, 'lib');
const FONTS = app.isPackaged ? path.join(process.resourcesPath, 'fonts') : path.join(__dirname, '..', 'fonts');
const MEDIA_EXT = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg'];
const SAVE_EXT = { srt: 'SRT', ass: 'ASS', mp4: 'MP4', mov: 'MOV', subtitulador: 'Proyecto Subtitulador' };
const PROJECT_EXT = '.subtitulador';
const MAX_JSON = 64 * 1024 * 1024;
const MAX_FONT = 64 * 1024 * 1024;

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
if (process.env.SUBT_DISABLE_GPU) app.disableHardwareAcceleration();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.otf': 'font/otf', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; font-src 'self' data: blob:; media-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'";
const SECURITY_HEADERS = { 'Content-Security-Policy': CSP, 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' };

const isStr = (v, max = 4096) => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\0');
const extOf = (p) => path.extname(p).slice(1).toLowerCase();
function absPath(p) {
  if (!isStr(p) || !path.isAbsolute(p)) throw new Error('Ruta inválida');
  return path.resolve(p);
}
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
function mediaPath(p) {
  const f = absPath(p);
  if (!MEDIA_EXT.includes(extOf(f)) || !isFile(f)) throw new Error('Archivo de medios no permitido');
  return f;
}
function projectPath(p) {
  const f = absPath(p);
  if (!f.toLowerCase().endsWith(PROJECT_EXT)) throw new Error('Proyecto no permitido');
  return f;
}
const writable = new Set();
function grantWrite(p) { writable.add(path.resolve(p)); return p; }
function writePath(p, exts) {
  const f = absPath(p);
  if (!exts.includes(extOf(f))) throw new Error('Extensión no permitida');
  if (!TEST_CFG && !writable.has(f)) throw new Error('Ruta de escritura no autorizada');
  return f;
}
function inside(base, f) { const r = path.relative(base, f); return !!r && !r.startsWith('..') && !path.isAbsolute(r); }
function readJson(p) {
  if (fs.statSync(p).size > MAX_JSON) throw new Error('Archivo demasiado grande');
  const v = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Formato inválido');
  return v;
}

async function serveMedia(req, file) {
  const size = (await fs.promises.stat(file)).size;
  const type = MIME['.' + extOf(file)] || 'application/octet-stream';
  const m = (req.headers.get('range') || '').match(/^bytes=(\d*)-(\d*)$/);
  let start = 0, end = size - 1;
  if (m && (m[1] || m[2])) { start = m[1] ? +m[1] : Math.max(0, size - +m[2]); end = m[1] && m[2] ? +m[2] : size - 1; }
  end = Math.min(end, size - 1);
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const body = require('stream').Readable.toWeb(fs.createReadStream(file, { start, end }));
  return new Response(body, { status: m ? 206 : 200, headers: { ...SECURITY_HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
}

function registerProtocol() {
  protocol.handle('app', async (req) => {
    try {
      const u = new URL(req.url);
      if (u.host !== 'app' || req.method !== 'GET') return new Response(null, { status: 403 });
      const p = decodeURIComponent(u.pathname);
      if (p === '/__media') return await serveMedia(req, mediaPath(u.searchParams.get('p')));
      let base = RENDERER, rel = p === '/' ? 'index.html' : p.slice(1);
      if (p.startsWith('/lib/')) { base = LIB; rel = p.slice(5); } else if (p.startsWith('/fonts/')) { base = FONTS; rel = p.slice(7); }
      const file = path.resolve(base, rel);
      if (!inside(base, file) || !MIME[path.extname(file)]) return new Response(null, { status: 403 });
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(file)] } });
    } catch { return new Response(null, { status: 404 }); }
  });
}

const storeFile = () => path.join(app.getPath('userData'), 'subtitulador.json');
function readStore() { try { return readJson(storeFile()); } catch { return {}; } }
function writeStore(s) { fs.mkdirSync(path.dirname(storeFile()), { recursive: true }); fs.writeFileSync(storeFile(), JSON.stringify(s, null, 2), { mode: 0o600 }); }
function initialLang() {
  const pref = ((readStore().settings || {}).uiLang);
  if (pref === 'es' || pref === 'en') return pref;
  return I18N.systemLang((app.getPreferredSystemLanguages()[0]) || app.getLocale() || 'en');
}

let win = null; let currentExport = null;
const allowedPermission = (perm, origin) => perm === 'local-fonts' && (origin || '').startsWith(ORIGIN);
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700, backgroundColor: '#0f1115', title: 'Subtitulador',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: DEV, spellcheck: false, navigateOnDragDrop: false,
    },
  });
  win.loadURL(`${ORIGIN}/index.html`);
  if (DEV && process.env.SUBT_DEVTOOLS) win.webContents.openDevTools();
  if (TEST_CFG || process.env.SUBT_LOG) win.webContents.on('console-message', (e) => console.log('[renderer]', e.message));
  win.on('close', (e) => { if (dirty && !forceClose && !TEST_CFG) { e.preventDefault(); send('menu', 'close'); } });
  win.on('closed', () => { win = null; });
}

function hardenSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(allowedPermission(perm, details.requestingUrl)));
  ses.setPermissionCheckHandler((wc, perm, origin) => allowedPermission(perm, origin));
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (e) => e.preventDefault());
}
app.on('web-contents-created', (e, wc) => {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (ev, url) => { if (!url.startsWith(ORIGIN + '/')) ev.preventDefault(); });
  wc.on('will-redirect', (ev, url) => { if (!url.startsWith(ORIGIN + '/')) ev.preventDefault(); });
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
});

function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!win || e.sender !== win.webContents || !e.senderFrame || !e.senderFrame.url.startsWith(ORIGIN + '/')) throw new Error('Origen no permitido');
    return fn(e, ...args);
  });
}

async function pickOpen(name, extensions) {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name, extensions }] });
  return r.canceled ? null : r.filePaths[0];
}
handle('dialog:openMedia', () => pickOpen(t('Video o audio'), MEDIA_EXT));
handle('dialog:openProject', () => pickOpen(t('Proyecto Subtitulador'), ['subtitulador']));
handle('dialog:openSubs', async () => {
  const p = await pickOpen(t('Subtítulos'), ['srt']);
  if (!p) return null;
  if (fs.statSync(p).size > 16 * 1024 * 1024) throw new Error('Archivo demasiado grande');
  return fs.readFileSync(p, 'utf8');
});
handle('dialog:save', async (e, o) => {
  const ext = o && typeof o.ext === 'string' && Object.hasOwn(SAVE_EXT, o.ext) ? o.ext : null;
  if (!ext) throw new Error('Extensión no permitida');
  const name = isStr(o.name, 255) ? path.basename(o.name) : 'subtitulos';
  const dir = isStr(o.dir) && path.isAbsolute(o.dir) ? o.dir : app.getPath('documents');
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(dir, name), filters: [{ name: t(SAVE_EXT[ext]), extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null;
  let f = path.resolve(r.filePath);
  if (extOf(f) !== ext) f += '.' + ext;
  return grantWrite(f);
});
handle('dialog:confirm', async (e, o) => {
  const buttons = Array.isArray(o && o.buttons) ? o.buttons.filter(b => isStr(b, 100)).slice(0, 4) : [];
  if (!buttons.length) throw new Error('Diálogo inválido');
  const cancelId = Number.isInteger(o.cancelId) && o.cancelId >= 0 && o.cancelId < buttons.length ? o.cancelId : buttons.length - 1;
  const r = await dialog.showMessageBox(win, { type: 'question', buttons, defaultId: 0, cancelId, message: isStr(o.message, 1000) ? o.message : '', detail: isStr(o.detail, 4000) ? o.detail : undefined });
  return r.response;
});
handle('file:write', (e, p, text) => {
  if (typeof text !== 'string' || text.length > MAX_JSON) throw new Error('Contenido inválido');
  fs.writeFileSync(writePath(p, ['srt', 'ass']), text, 'utf8'); return true;
});
handle('media:probe', (e, p) => ff.probe(mediaPath(p)));
handle('media:audio', async (e, p) => { const b = await ff.extractAudio(mediaPath(p)); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); });
handle('store:get', () => { const s = readStore(); return { style: s.style, presets: s.presets, settings: s.settings }; });
handle('store:set', (e, v) => {
  if (!v || typeof v !== 'object') throw new Error('Formato inválido');
  const json = JSON.stringify({ style: v.style, presets: v.presets, settings: v.settings });
  if (json.length > 4 * 1024 * 1024) throw new Error('Demasiado grande');
  writeStore({ ...JSON.parse(json), recents: readStore().recents || [] }); return true;
});
handle('shell:reveal', (e, p) => { const f = absPath(p); if (writable.has(f) || TEST_CFG) shell.showItemInFolder(f); });

handle('export:burn', async (e, job) => {
  if (!job || typeof job !== 'object' || typeof job.ass !== 'string' || job.ass.length > MAX_JSON) throw new Error('Trabajo inválido');
  if (currentExport) throw new Error('Ya hay una exportación en curso');
  const overlay = job.overlay ? String(job.overlay) : null;
  const output = writePath(job.output, overlay === 'alpha' || (!overlay && job.codec === 'prores') ? ['mov'] : ['mp4']);
  const input = mediaPath(job.input);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitulador-'));
  const ac = new AbortController(); currentExport = ac;
  try {
    const fdir = path.join(tmp, 'fonts'); fs.mkdirSync(fdir);
    for (const f of fs.readdirSync(FONTS).filter(f => /\.(ttf|otf)$/i.test(f))) fs.copyFileSync(path.join(FONTS, f), path.join(fdir, f));
    const fonts = Array.isArray(job.fonts) ? job.fonts.slice(0, 32) : [];
    fonts.forEach((f, i) => {
      if (!f || !(f.data instanceof Uint8Array) || f.data.byteLength > MAX_FONT) return;
      fs.writeFileSync(path.join(fdir, `system-${i}.font`), Buffer.from(f.data));
    });
    fs.writeFileSync(path.join(tmp, 'subs.ass'), job.ass, 'utf8');
    const info = await ff.probe(input);
    const args = overlay ? ff.overlayArgs({ output, mode: overlay, info })
      : ff.burnArgs({ input, output, codec: job.codec, crf: job.crf, preset: job.preset, info });
    const t0 = Date.now();
    const r = await ff.run(args, { cwd: tmp, signal: ac.signal, onStderr: s => {
      const m = s.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m && info.duration && !e.sender.isDestroyed()) e.sender.send('export:progress', Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / info.duration));
    } });
    if (r.code !== 0) return { ok: false, error: ac.signal.aborted ? 'Cancelado' : r.stderr.slice(-1500) };
    return { ok: true, seconds: (Date.now() - t0) / 1000, in: info, out: await ff.probe(output), args };
  } finally {
    currentExport = null;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
handle('export:cancel', () => { if (currentExport) currentExport.abort(); });

let pendingOpen = null; let rendererReady = false; let dirty = false; let forceClose = false;
const findProjectArg = (argv) => argv.find(a => typeof a === 'string' && a.toLowerCase().endsWith(PROJECT_EXT) && path.isAbsolute(a) && isFile(a)) || null;
function openProjectPath(p) {
  if (!p) return;
  if (win && rendererReady) { win.webContents.send('project:open', p); win.show(); } else pendingOpen = p;
}
function recents() { const r = readStore().recents; return (Array.isArray(r) ? r : []).filter(p => isStr(p) && path.isAbsolute(p) && isFile(p)).slice(0, 10); }
function addRecent(p) {
  const s = readStore(); s.recents = [p, ...recents().filter(x => x !== p)].slice(0, 10); writeStore(s);
  if (process.platform === 'darwin') app.addRecentDocument(p);
  buildMenu();
}
const send = (c, ...a) => { if (win) win.webContents.send(c, ...a); };
function buildMenu() {
  const rec = recents();
  const tpl = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: t('Archivo'), submenu: [
      { label: t('Nuevo proyecto'), accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
      { label: t('Abrir proyecto…'), accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open') },
      { label: t('Abrir recientes'), submenu: rec.length ? [...rec.map(p => ({ label: path.basename(p), sublabel: p, click: () => openProjectPath(p) })), { type: 'separator' },
        { label: t('Borrar lista'), click: () => { const s = readStore(); s.recents = []; writeStore(s); if (app.clearRecentDocuments) app.clearRecentDocuments(); buildMenu(); } }] : [{ label: t('(vacío)'), enabled: false }] },
      { type: 'separator' },
      { label: t('Guardar'), accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
      { label: t('Guardar como…'), accelerator: 'Shift+CmdOrCtrl+S', click: () => send('menu', 'saveAs') },
      { type: 'separator' },
      { label: t('Importar video o audio…'), click: () => send('menu', 'media') },
      ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit', label: t('Salir') }]),
    ] },
    { label: t('Idioma'), submenu: [['es', 'Español'], ['en', 'English']].map(([l, n]) => ({ label: n, type: 'radio', checked: I18N.getLang() === l, click: () => send('menu', 'lang:' + l) })) },
    { role: 'editMenu', label: t('Edición') },
    { label: t('Ver'), submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(DEV ? [{ role: 'reload' }, { role: 'toggleDevTools' }] : [])] },
    { role: 'windowMenu', label: t('Ventana') },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}
handle('ui:lang', (e, l) => { if ((l === 'es' || l === 'en') && l !== I18N.getLang()) { I18N.setLang(l); buildMenu(); } });
handle('project:ready', () => { rendererReady = true; const p = pendingOpen; pendingOpen = null; return p; });
handle('project:dirty', (e, d, title) => { dirty = d === true; if (win) { if (win.setDocumentEdited) win.setDocumentEdited(dirty); win.setTitle(isStr(title, 300) ? title : 'Subtitulador'); } });
handle('project:read', (e, p) => {
  const file = projectPath(p);
  const d = readJson(file);
  const m = d.media && typeof d.media === 'object' ? d.media : {};
  const cand = [m.path, isStr(m.relPath) ? path.resolve(path.dirname(file), m.relPath) : null];
  const resolved = cand.find(c => { try { return !!mediaPath(c); } catch { return false; } }) || null;
  grantWrite(file);
  return { lang: d.lang, segs: d.segs, style: d.style, settings: d.settings, export: d.export, media: { path: isStr(m.path) ? m.path : null, resolved } };
});
handle('project:write', (e, p, data) => {
  const file = writePath(projectPath(p), ['subtitulador']);
  if (!data || typeof data !== 'object') throw new Error('Formato inválido');
  const media = isStr(data.media && data.media.path) && path.isAbsolute(data.media.path) ? { path: data.media.path, relPath: path.relative(path.dirname(file), data.media.path) } : { path: null };
  const json = JSON.stringify({ app: 'Subtitulador', format: 1, media, lang: data.lang, segs: data.segs, style: data.style, settings: data.settings, export: data.export }, null, 2);
  if (json.length > MAX_JSON) throw new Error('Proyecto demasiado grande');
  fs.writeFileSync(file, json, 'utf8'); addRecent(file); return true;
});
handle('app:closeNow', () => { forceClose = true; if (win) win.close(); });

if (TEST_CFG) {
  handle('test:config', () => readJson(TEST_CFG));
  handle('test:shot', async (e, p) => { const img = await win.webContents.capturePage(); fs.writeFileSync(absPath(p), img.toPNG()); return p; });
  handle('test:done', (e, result) => { console.log('SELFTEST_RESULT ' + JSON.stringify(result)); setTimeout(() => app.exit(result && result.ok ? 0 : 1), 300); });
  handle('test:menu', async (e, out) => {
    const m = Menu.getApplicationMenu().items.find(i => i.label === t('Archivo'));
    win.setBounds({ x: 0, y: 0, width: 1000, height: 620 }); win.focus(); await new Promise(r => setTimeout(r, 600));
    m.submenu.popup({ window: win, x: 20, y: 40 }); await new Promise(r => setTimeout(r, 900));
    const r = require('child_process').spawnSync('python3', ['-c', 'import os,sys; from PIL import ImageGrab; ImageGrab.grab(xdisplay=os.environ["DISPLAY"]).crop((0,0,1000,620)).save(sys.argv[1])', absPath(out)], { encoding: 'utf8' });
    m.submenu.closePopup(win); return r.status === 0 ? out : r.stderr;
  });
} else {
  handle('test:config', () => null);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  pendingOpen = findProjectArg(process.argv.slice(1));
  app.on('second-instance', (e, argv) => { openProjectPath(findProjectArg(argv)); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('open-file', (e, p) => { e.preventDefault(); if (isStr(p) && p.toLowerCase().endsWith(PROJECT_EXT)) openProjectPath(p); });
  app.whenReady().then(() => {
    I18N.setLang(initialLang());
    hardenSession(); registerProtocol(); buildMenu(); createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
