// Subtitulador — lógica de la interfaz
const S = window.Subs; const api = window.api; const I18N = window.I18N; const t = I18N.t;
const $ = (s) => document.querySelector(s);
const BUNDLED = ['Poppins', 'Lato', 'Anton', 'Bebas Neue', 'Lobster', 'Permanent Marker'];
const FALLBACK_SYS = ['Helvetica Neue', 'Helvetica', 'Arial', 'Avenir Next', 'Futura', 'Gill Sans', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Impact', 'Menlo'];

const state = {
  file: null, info: null, segs: [], sel: -1, lang: null,
  style: { ...S.DEFAULT_STYLE }, presets: {}, settings: { model: 'small', device: 'auto', lang: 'auto', maxWords: 7, maxLines: 2 },
  undo: [], sysFonts: [], busy: false,
};
document.body.classList.add('platform-' + api.platform);

// ---------- utilidades UI ----------
function status(t) { $('#statusTxt').textContent = t; }
function progress(p, txt) {
  $('#progWrap').hidden = p == null; $('#progBar').style.width = ((p || 0) * 100).toFixed(1) + '%'; $('#progTxt').textContent = txt || '';
}
let toastT; function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, err ? 7000 : 3500); }
const mb = (b) => (b / 1048576).toFixed(0) + ' MB';
function pushUndo() { state.undo.push(JSON.stringify(state.segs)); if (state.undo.length > 100) state.undo.shift(); }
function undo() { if (!state.undo.length) return; state.segs = JSON.parse(state.undo.pop()); renderSegs(); renderOverlay(); }
function setBusy(b) {
  state.busy = b;
  $('#btnTranscribe').disabled = b || !state.file;
  $('#btnTranslate').disabled = b || !state.segs.length;
  const hasSegs = state.segs.length > 0;
  $('#btnBurn').disabled = b || !hasSegs || !state.info?.hasVideo;
  $('#btnOverlay').disabled = b || !hasSegs || !state.info?.hasVideo;
  $('#btnSrt').disabled = !hasSegs; $('#btnAss').disabled = !hasSegs;
}

// ---------- worker IA ----------
const worker = new Worker(new URL('./ml-worker.js', import.meta.url), { type: 'module' });
const pending = new Map(); let reqId = 0;
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'progress') {
    if (m.total) progress(m.pct, t('Descargando {s}: {a} / {b}', { s: t(m.stage), a: mb(m.loaded), b: mb(m.total) }));
    else progress(m.pct, `${t(m.stage)} ${(m.pct * 100).toFixed(0)}%`);
  } else if (m.type === 'status') status(t(m.k, m.p && Object.fromEntries(Object.entries(m.p).map(([k, v]) => [k, t(String(v))]))));
  else if (m.type === 'log') console.log(m.text);
  else if (m.type === 'done') { pending.get(m.id)?.res(m.result); pending.delete(m.id); }
  else if (m.type === 'error') { pending.get(m.id)?.rej(new Error(m.error)); pending.delete(m.id); }
};
function ml(type, payload, transfer) { const id = ++reqId; return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage({ id, type, payload }, transfer || []); }); }

// ---------- medición de fuentes (para que preview == libass) ----------
const cvs = document.createElement('canvas').getContext('2d');
function fontCss(st, px) { return `${st.italic ? 'italic ' : ''}${st.bold ? '700 ' : '400 '}${px}px "${st.fontFamily}"`; }
// libass usa (ascender+descender) como "tamaño"; CSS usa el em. Devuelve ratio alto/em.
// libass usa usWinAscent+usWinDescent (tabla OS/2) para el tamaño. Lo leemos del archivo de la fuente.
const BUNDLED_FILES = { 'Poppins': ['Poppins-Regular', 'Poppins-Bold', 'Poppins-Italic', 'Poppins-BoldItalic'], 'Lato': ['Lato-Regular', 'Lato-Bold', 'Lato-Italic', 'Lato-BoldItalic'],
  'Anton': ['Anton-Regular'], 'Bebas Neue': ['BebasNeue-Regular'], 'Lobster': ['Lobster-Regular'], 'Permanent Marker': ['PermanentMarker-Regular'] };
const metricCache = new Map();
function parseWinRatio(buf) {
  const dv = new DataView(buf); let base = 0;
  if (dv.getUint32(0) === 0x74746366) base = dv.getUint32(12); // 'ttcf' → primera fuente
  const n = dv.getUint16(base + 4); const t = {};
  for (let i = 0; i < n; i++) { const o = base + 12 + i * 16; t[String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3))] = dv.getUint32(o + 8); }
  const upm = dv.getUint16(t.head + 18);
  if (t['OS/2'] != null) { const a = dv.getUint16(t['OS/2'] + 74), d = dv.getUint16(t['OS/2'] + 76); if (a + d) { parseWinRatio.asc = a / upm; return (a + d) / upm; } }
  if (t.hhea != null) { parseWinRatio.asc = dv.getInt16(t.hhea + 4) / upm; } if (t.hhea != null) return (dv.getInt16(t.hhea + 4) - dv.getInt16(t.hhea + 6)) / upm;
  return null;
}
async function ensureMetrics(st) {
  const key = `${st.fontFamily}|${st.bold}|${st.italic}`; if (metricCache.has(key)) return metricCache.get(key);
  let r = null;
  try {
    const files = BUNDLED_FILES[st.fontFamily];
    if (files) {
      const pick = files.length === 4 ? files[(st.bold ? 1 : 0) + (st.italic ? 2 : 0)] : files[0];
      r = parseWinRatio(await (await fetch(`/fonts/${pick}.ttf`)).arrayBuffer());
    } else if (state.localFonts) {
      const cands = state.localFonts.filter(f => f.family === st.fontFamily);
      const want = (st.bold ? 'bold' : '') + (st.italic ? 'italic' : '');
      const f = cands.find(f => f.style.toLowerCase().replace(/\s|oblique/g, m => m === 'oblique' ? 'italic' : '') === (want || 'regular')) || cands[0];
      if (f) r = parseWinRatio(await (await f.blob()).arrayBuffer());
    }
  } catch (e) { console.warn('métricas', e); }
  if (r) ascCache.set(key, parseWinRatio.asc); metricCache.set(key, r); return r;
}
// Desplazamiento vertical (en em) entre la línea base de libass (winAscent) y la de CSS (hhea/typo centrado en el line-height)
const ascCache = new Map();
function baselineShift(st, ratio) {
  const asc = ascCache.get(`${st.fontFamily}|${st.bold}|${st.italic}`); if (asc == null) return 0;
  cvs.font = fontCss(st, 100); const m = cvs.measureText('Hg');
  const A = m.fontBoundingBoxAscent / 100, D = m.fontBoundingBoxDescent / 100;
  return asc - ((ratio - (A + D)) / 2 + A);
}
function fontRatio(st) {
  const k = `${st.fontFamily}|${st.bold}|${st.italic}`;
  if (metricCache.get(k)) return metricCache.get(k);
  if (!metricCache.has(k)) ensureMetrics(st).then(() => renderOverlay());
  cvs.font = fontCss(st, 100); const m = cvs.measureText('Hg');
  const r = (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / 100;
  return r > 0.5 && r < 3 ? r : 1.2;
}
function measureFn(st, px) { cvs.font = fontCss(st, px); return (t) => cvs.measureText(t).width; }
function layoutSegs(segs, st, W, H) {
  const g = S.geometry(st, W, H); const meas = measureFn(st, g.fontPx);
  const pad = st.box ? g.outline * 2 : g.outline * 2;
  return segs.map(s => ({ ...s, lines: s.text.split(/\n/).flatMap(p => S.wrap(p, g.maxW - pad, meas)) }));
}
function dims() { const i = state.info; return i && i.width ? [i.width, i.height] : [1920, 1080]; }
function buildAss() { const [W, H] = dims(); return S.buildASS(layoutSegs(sorted(), state.style, W, H), state.style, W, H, { fontScale: fontRatio(state.style) }); }
const sorted = () => [...state.segs].sort((a, b) => a.start - b.start);

// ---------- abrir archivo ----------
async function openFile(p) {
  if (!p) return;
  if (/\.subtitulador$/i.test(p)) return loadProject(p);
  status(t('Analizando archivo…'));
  const info = await api.probe(p);
  if (!info.hasAudio && !info.hasVideo) { toast(t('No pude leer ese archivo.'), true); return; }
  state.file = p; state.info = info;
  $('#fileName').textContent = p.split(/[\\/]/).pop();
  $('#infoLbl').textContent = info.hasVideo ? `${info.width}×${info.height} · ${info.fps} fps · ${info.vcodec}` : t('solo audio · {c}', { c: info.acodec });
  const v = $('#video'); v.src = 'app://app/__media?p=' + encodeURIComponent(p);
  $('#player').classList.add('has-media');
  await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 4000); });
  status(t('Archivo listo. Podés transcribir o agregar subtítulos a mano.'));
  setBusy(false); layoutOverlay(); renderTimeline();
}

// ---------- transcripción ----------
async function transcribe() {
  if (!state.file || state.busy) return;
  setBusy(true);
  try {
    status(t('Extrayendo audio…')); progress(0, '');
    const buf = await api.audio(state.file);
    const audio = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
    const t0 = performance.now();
    const r = await ml('transcribe', { audio, lang: $('#langSel').value, model: state.settings.model, device: state.settings.device }, [audio.buffer]);
    pushUndo();
    state.wordTimestamps = !!(r.words && r.words.length);
    state.segs = segmentWords(state.wordTimestamps ? r.words : S.wordsFromSegs(r.segments));
    state.lang = r.lang || S.guessLang(state.segs.map(s => s.text).join(' '));
    const secs = (performance.now() - t0) / 1000;
    status(t('Transcripción lista: {n} subtítulos · {ts} · idioma {lang} · {s} s ({dev})', { n: state.segs.length, ts: t(state.wordTimestamps ? 'tiempos por palabra' : 'tiempos estimados'), lang: t(state.lang === 'es' ? 'español' : 'inglés'), s: secs.toFixed(1), dev: r.device === 'webgpu' ? 'GPU' : 'CPU' }));
    window.__lastTranscribe = { wordTimestamps: state.wordTimestamps, seconds: secs, audioSeconds: r.seconds, device: r.device, lang: state.lang };
    renderSegs(); renderOverlay(); renderTimeline();
  } catch (e) { console.error(e); toast(t('Error al transcribir: {e}', { e: e.message.split('\n')[0] }), true); status(t('Error al transcribir.')); }
  finally { progress(null); setBusy(false); }
}

// ---------- segmentación por palabras ----------
function fitsFn() {
  const [W, H] = dims(); const st = state.style; const g = S.geometry(st, W, H); const meas = measureFn(st, g.fontPx);
  const maxL = +state.settings.maxLines || 2;
  return (t) => S.wrap(t, g.maxW - g.outline * 2, meas).length <= maxL;
}
function segmentWords(words) {
  return S.resegment(words, { maxWords: +state.settings.maxWords, fits: fitsFn() }).map(s => ({ ...s, id: crypto.randomUUID() }));
}
function resegmentAll() {
  if (!state.segs.length) return; pushUndo();
  const before = state.segs.length;
  state.segs = segmentWords(S.wordsFromSegs(sorted()));
  status(t('Re-segmentado: {a} → {b} subtítulos (⌘Z para deshacer).', { a: before, b: state.segs.length }));
  renderSegs(); renderOverlay(); renderTimeline();
}

// ---------- traducción ----------
async function translate() {
  if (!state.segs.length || state.busy) return;
  let dir = $('#trSel').value;
  if (dir === 'auto') { const l = state.lang || S.guessLang(state.segs.map(s => s.text).join(' ')); dir = l === 'es' ? 'es-en' : 'en-es'; }
  setBusy(true);
  try {
    status(t('Traduciendo ({dir})…', { dir: t(dir === 'en-es' ? 'inglés → español' : 'español → inglés') }));
    // traducimos oraciones completas y después volvemos a cortar según el límite de palabras
    const groups = S.groupSentences(sorted());
    const out = await ml('translate', { texts: groups.map(g => g.text), from: dir.slice(0, 2), to: dir.slice(3) });
    pushUndo();
    const words = groups.flatMap((g, i) => S.spreadWords(out[i], g.start, g.end));
    state.segs = segmentWords(words); state.lang = dir.slice(3);
    status(t('Traducción lista (los tiempos se mantienen). ⌘Z para volver al original.'));
    renderSegs(); renderOverlay(); renderTimeline();
  } catch (e) { console.error(e); toast(t('Error al traducir: {e}', { e: e.message.split('\n')[0] }), true); }
  finally { progress(null); setBusy(false); }
}

// ---------- lista de segmentos ----------
function renderSegs() {
  const list = $('#segList'); list.innerHTML = '';
  const segs = sorted(); state.segs = segs;
  $('#segCount').textContent = segs.length ? t('{n} subtítulos', { n: segs.length }) : '';
  if (!segs.length) list.innerHTML = `<p class="hint">${t('Todavía no hay subtítulos. Transcribí el audio o agregalos a mano con “＋ Agregar en el cursor”.')}</p>`;
  segs.forEach((s, i) => {
    const el = document.createElement('div'); el.className = 'seg' + (i === state.sel ? ' sel' : ''); el.dataset.id = s.id;
    el.innerHTML = `<div class="num">${i + 1}</div>
      <div class="times"><button data-a="go" title="${t('Ir a este subtítulo')}">▶</button>
        <input class="t-start" value="${S.fmtClock(s.start)}" title="${t('Inicio')}"><button data-a="setStart" title="${t('Inicio = cursor')}">⇤</button>
        <span class="muted">→</span>
        <input class="t-end" value="${S.fmtClock(s.end)}" title="${t('Fin')}"><button data-a="setEnd" title="${t('Fin = cursor')}">⇥</button>
        <span class="spacer"></span><button data-a="del" title="${t('Borrar')}">✕</button></div>
      <textarea rows="2"></textarea>`;
    el.querySelector('textarea').value = s.text;
    el.querySelector('textarea').addEventListener('focus', () => { pushUndo(); state.sel = i; markSel(); });
    el.querySelector('textarea').addEventListener('input', (e) => { s.text = e.target.value; s.words = null; renderOverlay(); renderTimeline(); });
    const tIn = (cls, key) => el.querySelector(cls).addEventListener('change', (e) => {
      const v = S.parseClock(e.target.value); if (isNaN(v)) { e.target.value = S.fmtClock(s[key]); return; }
      pushUndo(); s[key] = v; s.words = null; if (s.end <= s.start) s.end = s.start + 0.5; renderSegs(); renderOverlay(); renderTimeline();
    });
    tIn('.t-start', 'start'); tIn('.t-end', 'end');
    el.querySelectorAll('button[data-a]').forEach(b => b.onclick = () => {
      const v = $('#video'); const a = b.dataset.a; state.sel = i;
      if (a === 'go') { v.currentTime = s.start + 0.01; markSel(); return; }
      pushUndo();
      if (a !== 'del') s.words = null;
      if (a === 'setStart') { s.start = v.currentTime; if (s.end <= s.start) s.end = s.start + 2; }
      if (a === 'setEnd') { s.end = Math.max(s.start + 0.1, v.currentTime); }
      if (a === 'del') { state.segs = state.segs.filter(x => x !== s); state.sel = -1; }
      renderSegs(); renderOverlay(); renderTimeline();
    });
    list.appendChild(el);
  });
  setBusy(state.busy);
}
function markSel() { document.querySelectorAll('.seg').forEach((el, i) => el.classList.toggle('sel', i === state.sel)); renderTimeline(); }
function addSeg() {
  const t = $('#video').currentTime || 0; pushUndo();
  const next = sorted().find(s => s.start > t);
  const seg = { id: crypto.randomUUID(), start: t, end: Math.min(t + 2.5, next ? next.start : t + 2.5) || t + 2.5, text: t('Nuevo subtítulo') };
  if (seg.end - seg.start < 0.3) seg.end = t + 1;
  state.segs.push(seg); renderSegs();
  const idx = sorted().indexOf(seg); state.sel = idx; markSel();
  const ta = document.querySelectorAll('.seg textarea')[idx]; ta?.focus(); ta?.select(); ta?.scrollIntoView({ block: 'center' });
  renderOverlay();
}

// ---------- preview con overlay ----------
let vbox = { x: 0, y: 0, w: 0, h: 0 };
function layoutOverlay() {
  const p = $('#player').getBoundingClientRect(); const [W, H] = dims();
  const sc = Math.min(p.width / W, p.height / H); const w = W * sc, h = H * sc;
  vbox = { x: (p.width - w) / 2, y: (p.height - h) / 2, w, h, sc };
  Object.assign($('#overlay').style, { left: vbox.x + 'px', top: vbox.y + 'px', width: w + 'px', height: h + 'px' });
  renderOverlay();
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function renderOverlay() {
  const ov = $('#overlay'); const t = $('#video').currentTime || 0; const st = state.style; const [W, H] = dims();
  const active = layoutSegs(sorted().filter(s => t >= s.start && t < s.end && s.text.trim()), st, W, H);
  document.querySelectorAll('.seg').forEach(el => { const s = state.segs.find(x => x.id === el.dataset.id); el.classList.toggle('active', !!s && t >= s.start && t < s.end); });
  ov.innerHTML = '';
  const g = S.geometry(st, W, H); const k = vbox.sc || 1; const ratio = fontRatio(st);
  const bshift = baselineShift(st, ratio) * g.fontPx;
  const lineH = g.fontPx * ratio; // alto de línea en px de video (= tamaño ASS)
  for (const s of active) {
    // cada línea se posiciona igual que su evento ASS (ver Subs.linePositions)
    const pos = S.linePositions(g, s.lines.length, lineH);
    const top = Math.min(...pos.map(p => p.an === 2 ? p.y - lineH : p.an === 8 ? p.y : p.y - lineH / 2));
    const d = document.createElement('div'); d.className = 'sub' + (st.box ? ' boxed' : '');
    const blockH = (s.lines.length - 1) * lineH * g.lh + lineH;
    Object.assign(d.style, { left: g.x * k + 'px', top: top * k + 'px', height: blockH * k + 'px', width: '0px' });
    s.lines.forEach((line, i) => {
      const p = pos[i]; const ly = (p.an === 2 ? p.y - lineH : p.an === 8 ? p.y : p.y - lineH / 2) - top + bshift;
      const l = document.createElement('div'); l.className = 'ln'; l.textContent = line;
      Object.assign(l.style, { position: 'absolute', left: '0', top: ly * k + 'px', transform: 'translateX(-50%)', whiteSpace: 'pre',
        font: fontCss(st, g.fontPx * k), lineHeight: lineH * k + 'px', height: lineH * k + 'px', color: st.color });
      if (st.box) Object.assign(l.style, { background: hexA(st.boxColor, st.boxOpacity), padding: `${g.outline * k}px`, top: (ly - g.outline) * k + 'px', height: 'auto' });
      else {
        if (g.outline > 0) Object.assign(l.style, { WebkitTextStroke: `${2 * g.outline * k}px ${st.outlineColor}`, paintOrder: 'stroke fill' });
        // libass \blur ≈ desvío gaussiano; CSS text-shadow usa radio = 2σ
        if (g.shadow > 0 || g.blur > 0) l.style.textShadow = `${g.shadow * k}px ${g.shadow * k}px ${(g.blur * 2 * BLUR_K) * k}px ${hexA(st.shadowColor, st.shadowOpacity)}`;
      }
      d.appendChild(l);
    });
    d.addEventListener('mousedown', startDrag);
    ov.appendChild(d);
  }
}
const BLUR_K = 1.0;
function startDrag(e) {
  e.preventDefault(); const el = e.currentTarget; el.classList.add('dragging');
  const r = $('#overlay').getBoundingClientRect(); const st = state.style; const [W, H] = dims();
  const g = S.geometry(st, W, H); const k = vbox.sc;
  const eb = el.getBoundingClientRect(); const offX = e.clientX - (r.left + g.x * k), offY = e.clientY - eb.bottom;
  const move = (ev) => {
    st.position = 'custom';
    st.customX = Math.max(0, Math.min(100, (ev.clientX - offX - r.left) / r.width * 100));
    st.customY = Math.max(0, Math.min(100, (ev.clientY - offY - r.top) / r.height * 100));
    syncStyleUI(); renderOverlay();
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); saveStore(); };
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
}

// ---------- timeline ----------
function renderTimeline() {
  const tl = $('#timeline'); const dur = state.info?.duration || $('#video').duration || 1;
  tl.querySelectorAll('.blk').forEach(b => b.remove());
  sorted().forEach((s, i) => {
    const b = document.createElement('div'); b.className = 'blk' + (i === state.sel ? ' sel' : '');
    b.style.left = (s.start / dur * 100) + '%'; b.style.width = Math.max(0.3, (s.end - s.start) / dur * 100) + '%'; b.textContent = s.text;
    tl.appendChild(b);
  });
}
function tick() {
  const v = $('#video'); const dur = v.duration || state.info?.duration || 0;
  $('#timeLbl').textContent = `${S.fmtClock(v.currentTime || 0)} / ${S.fmtClock(dur)}`;
  if (!seeking) $('#seek').value = dur ? (v.currentTime / dur * 1000) : 0;
  $('#playhead').style.left = dur ? (v.currentTime / dur * 100) + '%' : '0';
  $('#btnPlay').textContent = v.paused ? '▶' : '⏸';
  renderOverlay();
}
let seeking = false;

// ---------- estilos ----------
const STYLE_KEYS = Object.keys(S.DEFAULT_STYLE);
function syncStyleUI() {
  const st = state.style;
  for (const k of STYLE_KEYS) {
    const el = document.getElementById('st-' + k); if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!st[k]; else el.value = st[k];
    const o = el.parentElement.querySelector('output'); if (o) o.textContent = (+st[k]).toFixed(el.step && el.step < 1 ? (el.step < 0.1 ? 2 : 1) : 0);
  }
  document.querySelectorAll('#posBtns button').forEach(b => b.classList.toggle('on', b.dataset.pos === st.position));
  $('#blurRow').hidden = st.shadowType !== 'blur';
}
function bindStyleUI() {
  for (const k of STYLE_KEYS) {
    const el = document.getElementById('st-' + k); if (!el) continue;
    el.addEventListener('input', () => {
      state.style[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
      if ((k === 'offsetX' || k === 'offsetY' || k === 'marginV') && state.style.position === 'custom') state.style.position = 'bottom';
      syncStyleUI(); renderOverlay(); saveStore();
    });
  }
  document.querySelectorAll('#posBtns button').forEach(b => b.onclick = () => { state.style.position = b.dataset.pos; syncStyleUI(); renderOverlay(); saveStore(); });
}
async function loadFonts() {
  const sel = $('#st-fontFamily'); let sys = [];
  try { if (window.queryLocalFonts) { const fs = await window.queryLocalFonts(); state.localFonts = fs; sys = [...new Set(fs.map(f => f.family))].sort((a, b) => a.localeCompare(b)); } } catch (e) { console.warn('queryLocalFonts', e); }
  if (!sys.length) sys = FALLBACK_SYS;
  state.sysFonts = sys;
  sel.innerHTML = `<optgroup label="${t('Incluidas (Google Fonts)')}">${BUNDLED.map(f => `<option>${f}</option>`).join('')}</optgroup><optgroup label="${t('Del sistema')}">${sys.filter(f => !BUNDLED.includes(f)).map(f => `<option>${f}</option>`).join('')}</optgroup>`;
  sel.value = state.style.fontFamily;
  await Promise.all(BUNDLED.map(f => document.fonts.load(`700 20px "${f}"`).catch(() => {})));
}
function renderPresets() {
  const sel = $('#presetSel'); const names = Object.keys(state.presets);
  sel.innerHTML = `<option value="">${t('— Presets guardados ({n}) —', { n: names.length })}</option>` + names.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${BUILTIN_PRESETS[n] ? t(n) : n}</option>`).join('');
}
const BUILTIN_PRESETS = {
  'Clásico (borde negro)': { ...S.DEFAULT_STYLE },
  'Caja oscura': { ...S.DEFAULT_STYLE, fontFamily: 'Lato', bold: false, box: true, boxOpacity: 0.65, shadow: false },
  'Redes (amarillo grande)': { ...S.DEFAULT_STYLE, fontFamily: 'Anton', bold: false, fontSize: 8, color: '#FFE14D', outlineWidth: 0.5, position: 'middle', maxWidth: 70 },
};

// ---------- persistencia ----------
let saveT; function saveStore() { clearTimeout(saveT); saveT = setTimeout(() => api.storeSet({ style: state.style, presets: state.presets, settings: state.settings }), 300); }

// ---------- exportación ----------
function baseName() { return state.file ? state.file.replace(/\.[^./\\]+$/, '') : 'subtitulos'; }
async function exportText(kind) {
  const [W, H] = dims();
  await ensureMetrics(state.style);
  const text = kind === 'srt' ? S.toSRT(sorted()) : buildAss();
  const p = await api.save({ defaultPath: `${baseName()}.${kind}`, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] });
  if (!p) return; await api.write(p, text); toast(t('Guardado: {f}', { f: p.split(/[\\/]/).pop() }));
  return p;
}
async function systemFontFiles() {
  const fam = state.style.fontFamily; if (BUNDLED.includes(fam) || !state.localFonts) return [];
  const out = [];
  for (const f of state.localFonts.filter(f => f.family === fam)) {
    try { const b = await f.blob(); out.push({ file: f.postscriptName.replace(/[^\w.-]/g, '_') + '.font', data: new Uint8Array(await b.arrayBuffer()) }); } catch {}
  }
  return out;
}
async function burn(outPath, overlay) {
  const codec = $('#codecSel').value; const ext = overlay ? (overlay === 'alpha' ? 'mov' : 'mp4') : codec === 'prores' ? 'mov' : 'mp4';
  const p = outPath || await api.save({ defaultPath: `${baseName()}-${overlay ? 'solo-subs' + (overlay === 'alpha' ? '' : '-' + overlay) : 'subtitulado'}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (!p) return;
  setBusy(true); $('#btnCancel').hidden = false; status(t(overlay ? 'Exportando video solo con subtítulos…' : 'Exportando video con subtítulos…')); progress(0, '0%');
  try {
    await ensureMetrics(state.style);
    const r = await api.burn({ input: state.file, output: p, overlay, ass: buildAss(), codec, crf: +$('#crf').value, preset: $('#encPreset').value, fonts: await systemFontFiles() });
    if (!r.ok) { $('#exportLog').textContent = r.error; toast(t(r.error === 'Cancelado' ? 'Exportación cancelada.' : 'Error al exportar (ver detalle).'), r.error !== 'Cancelado'); return r; }
    const msg = t('Listo en {s} s → {w}×{h} @ {fps} fps (original {iw}×{ih} @ {ifps})', { s: r.seconds.toFixed(1), w: r.out.width, h: r.out.height, fps: r.out.fps, iw: r.in.width, ih: r.in.height, ifps: r.in.fps });
    $('#exportLog').textContent = msg + '\n' + p; status(t('Video exportado. {m}', { m: msg })); toast(t('Video exportado ✔')); api.reveal(p);
    return r;
  } finally { setBusy(false); $('#btnCancel').hidden = true; progress(null); }
}
api.onExportProgress(p => progress(p, t('exportando {p}%', { p: (p * 100).toFixed(0) })));

// ---------- eventos ----------
function bind() {
  $('#btnOpen').onclick = async () => openFile(await api.openMedia());
  $('#btnTranscribe').onclick = transcribe; $('#btnTranslate').onclick = translate;
  $('#btnReseg').onclick = resegmentAll;
  $('#maxWordsSel').onchange = (e) => { state.settings.maxWords = +e.target.value; saveStore(); };
  $('#maxLinesSel').onchange = (e) => { state.settings.maxLines = +e.target.value; saveStore(); };
  $('#btnAdd').onclick = addSeg; $('#btnUndo').onclick = undo;
  $('#btnImport').onclick = async () => { const t = await api.openSubs(); if (!t) return; pushUndo(); state.segs = S.parseSRT(t).map(s => ({ ...s, id: crypto.randomUUID() })); renderSegs(); renderOverlay(); renderTimeline(); };
  $('#btnSrt').onclick = () => exportText('srt'); $('#btnAss').onclick = () => exportText('ass');
  $('#uiLangSel').onchange = (e) => setUiLang(e.target.value);
  $('#btnBurn').onclick = () => burn(); $('#btnOverlay').onclick = () => burn(null, $('#ovlSel').value); $('#btnCancel').onclick = () => api.cancelExport();
  const v = $('#video');
  $('#btnPlay').onclick = () => v.paused ? v.play() : v.pause();
  v.addEventListener('timeupdate', tick); v.addEventListener('seeked', tick); v.addEventListener('loadedmetadata', () => { tick(); renderTimeline(); });
  const loop = () => { if (!v.paused) tick(); requestAnimationFrame(loop); }; loop();
  const sk = $('#seek'); sk.oninput = () => { seeking = true; v.currentTime = (v.duration || 0) * sk.value / 1000; }; sk.onchange = () => seeking = false;
  $('#timeline').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); v.currentTime = (v.duration || 0) * (e.clientX - r.left) / r.width; };
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
  });
  window.addEventListener('resize', layoutOverlay); new ResizeObserver(layoutOverlay).observe($('#player'));
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !typing) { e.preventDefault(); undo(); }
    if (e.key === ' ' && !typing) { e.preventDefault(); $('#btnPlay').click(); }
  });
  const pl = $('#player');
  pl.addEventListener('dragover', e => { e.preventDefault(); pl.classList.add('dragover'); });
  pl.addEventListener('dragleave', () => pl.classList.remove('dragover'));
  pl.addEventListener('drop', e => { e.preventDefault(); pl.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) openFile(api.pathForFile(f)); });
  // ajustes
  $('#modelSel').onchange = (e) => { state.settings.model = e.target.value; saveStore(); };
  $('#deviceSel').onchange = (e) => { state.settings.device = e.target.value; saveStore(); };
  $('#langSel').onchange = (e) => { state.settings.lang = e.target.value; saveStore(); };
  const crf = $('#crf'); const crfOut = () => crf.nextElementSibling.textContent = crf.value; crf.oninput = crfOut; crfOut();
  $('#codecSel').onchange = (e) => { const pr = e.target.value === 'prores'; $('#crfRow').hidden = pr; $('#presetRow').hidden = pr; if (e.target.value === 'hevc' && +crf.value === 15) { crf.value = 17; crfOut(); } };
  // presets
  $('#presetSel').onchange = (e) => { const p = state.presets[e.target.value]; if (p) { state.style = { ...S.DEFAULT_STYLE, ...p }; $('#st-fontFamily').value = state.style.fontFamily; syncStyleUI(); renderOverlay(); saveStore(); } };
  $('#btnPresetSave').onclick = () => { const n = $('#presetName').value.trim(); if (!n) { toast(t('Poné un nombre para el preset.')); return; } state.presets[n] = { ...state.style }; renderPresets(); $('#presetSel').value = n; $('#presetName').value = ''; saveStore(); toast(t('Preset “{n}” guardado', { n })); };
  $('#btnPresetDel').onclick = () => { const n = $('#presetSel').value; if (!n) return; delete state.presets[n]; renderPresets(); saveStore(); };
}

// ---------- inicio ----------
async function init() {
  const saved = await api.storeGet();
  if (saved.style) state.style = { ...S.DEFAULT_STYLE, ...saved.style };
  state.presets = saved.presets || { ...BUILTIN_PRESETS };
  if (saved.settings) Object.assign(state.settings, saved.settings);
  $('#modelSel').value = state.settings.model; $('#deviceSel').value = state.settings.device; $('#langSel').value = state.settings.lang; $('#maxWordsSel').value = String(state.settings.maxWords); $('#maxLinesSel').value = String(state.settings.maxLines);
  applyUiLang();
  bind(); bindStyleUI(); await loadFonts(); syncStyleUI(); renderPresets(); renderSegs(); layoutOverlay();
  const gpu = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
  state.gpu = !!gpu; renderAbout();
  initProject();
  const cfg = await api.test.config(); if (cfg) selfTest(cfg);
}

// ---------- idioma de la interfaz ----------
function renderAbout() { $('#aboutTxt').textContent = t('Subtitulador {v} · Whisper + Opus-MT (transformers.js) · ffmpeg + libass.', { v: APP_VERSION }) + t(state.gpu ? ' · GPU (WebGPU) disponible ✔' : ' · WebGPU no disponible: se usa CPU (WASM).'); }
const APP_VERSION = '1.3';
function applyUiLang() {
  const pref = state.settings.uiLang || 'auto';
  I18N.setLang(pref === 'auto' ? I18N.systemLang(navigator.language) : pref);
  I18N.apply(document); $('#uiLangSel').value = pref;
  api.setUiLang(I18N.getLang());
}
function setUiLang(pref) {
  state.settings.uiLang = pref; saveStore(); applyUiLang();
  const sel = $('#statusTxt'); if (sel && !sel.textContent.trim()) sel.textContent = t('Listo.');
  renderAbout(); renderPresets(); loadFonts(); renderSegs(); lastDirty = null; refreshDirty();
  if (!state.file) $('#fileName').textContent = t('Ningún archivo abierto — también podés arrastrarlo acá');
}

// ---------- proyectos (.subtitulador) ----------
const proj = { path: null, saved: null };
function projectData() {
  return { app: 'Subtitulador', format: 1, media: { path: state.file }, lang: state.lang,
    segs: state.segs.map(({ id, start, end, text, words }) => ({ id, start, end, text, ...(words ? { words } : {}) })),
    style: state.style, settings: { ...state.settings },
    export: { codec: $('#codecSel').value, crf: +$('#crf').value, preset: $('#encPreset').value, overlay: $('#ovlSel').value } };
}
const snap = () => { const d = projectData(); return JSON.stringify([d.media.path, d.segs, d.style, d.settings, d.export]); };
const projName = () => proj.path ? proj.path.split(/[\\/]/).pop().replace(/\.subtitulador$/, '') : t('Sin título');
function isDirty() { return snap() !== proj.saved; }
let lastDirty = null;
function refreshDirty() {
  const d = isDirty(); const key = d + projName(); if (key === lastDirty) return; lastDirty = key;
  $('#projName').textContent = projName(); $('#projDot').hidden = !d;
  api.project.dirty(d, `${d ? '● ' : ''}${projName()} — Subtitulador`);
}
function markSaved() { proj.saved = snap(); lastDirty = null; refreshDirty(); }
async function confirmDiscard() {
  if (!isDirty() || (!state.file && !state.segs.length)) return true;
  const r = await api.project.confirm({ message: t('¿Guardar los cambios de “{n}”?', { n: projName() }), detail: t('Si no los guardás, se pierden.'), buttons: [t('Guardar'), t('No guardar'), t('Cancelar')], cancelId: 2 });
  if (r === 2) return false; if (r === 0) return await saveProject(false);
  return true;
}
async function saveProject(as, forcePath) {
  let p = forcePath || (!as && proj.path);
  if (!p) p = await api.save({ defaultPath: `${state.file ? baseName() : projName()}.subtitulador`, filters: [{ name: t('Proyecto Subtitulador'), extensions: ['subtitulador'] }] });
  if (!p) return false; if (!p.endsWith('.subtitulador')) p += '.subtitulador';
  await api.project.write(p, projectData()); proj.path = p; markSaved(); toast(t('Proyecto guardado ✔')); return true;
}
function applyExport(x) {
  if (!x) return; if (x.codec) { $('#codecSel').value = x.codec; $('#codecSel').onchange({ target: $('#codecSel') }); }
  if (x.crf) { $('#crf').value = x.crf; $('#crf').dispatchEvent(new Event('input')); } if (x.preset) $('#encPreset').value = x.preset; if (x.overlay) $('#ovlSel').value = x.overlay;
}
async function loadProject(p, opts = {}) {
  if (!p) return false; if (!opts.skipConfirm && !await confirmDiscard()) return false;
  let d; try { d = await api.project.read(p); } catch (e) { toast(t('No pude abrir el proyecto: {e}', { e: e.message }), true); return false; }
  let media = d.media && d.media.resolved;
  if (d.media && d.media.path && !media) {
    const r = opts.relink !== undefined ? (opts.relink ? 0 : 1) : await api.project.confirm({ message: t('No encuentro el video del proyecto.'), detail: t('Estaba en:\n{p}\n\n¿Querés buscarlo (por si lo moviste)?', { p: d.media.path }), buttons: [t('Buscar video…'), t('Abrir sin video')], cancelId: 1 });
    if (r === 0) media = opts.relinkPath || await api.openMedia();
  }
  state.style = { ...S.DEFAULT_STYLE, ...(d.style || {}) }; Object.assign(state.settings, d.settings || {}); state.lang = d.lang || null;
  state.segs = (d.segs || []).map(s => ({ ...s, id: s.id || crypto.randomUUID() })); state.undo = []; state.sel = -1;
  $('#maxWordsSel').value = String(state.settings.maxWords); $('#maxLinesSel').value = String(state.settings.maxLines); $('#langSel').value = state.settings.lang;
  $('#modelSel').value = state.settings.model; $('#deviceSel').value = state.settings.device; applyExport(d.export);
  $('#st-fontFamily').value = state.style.fontFamily; syncStyleUI();
  if (media) await openFile(media); else { state.file = null; }
  await ensureMetrics(state.style); renderSegs(); renderOverlay(); renderTimeline();
  proj.path = p; markSaved(); if (media && media !== (d.media || {}).path) { proj.saved = null; refreshDirty(); toast(t('Video re-vinculado. Guardá para recordar la nueva ubicación.')); }
  return true;
}
async function newProject() {
  if (!await confirmDiscard()) return;
  state.file = null; state.info = null; state.segs = []; state.undo = []; state.sel = -1; proj.path = null;
  const v = $('#video'); v.removeAttribute('src'); v.load(); $('#player').classList.remove('has-media');
  $('#fileName').textContent = t('Ningún archivo abierto — también podés arrastrarlo acá'); $('#infoLbl').textContent = '';
  renderSegs(); renderOverlay(); renderTimeline(); setBusy(false); markSaved();
}
async function initProject() {
  markSaved(); setInterval(refreshDirty, 700);
  api.project.onMenu(async (c) => {
    if (c === 'new') newProject(); else if (c === 'open') loadProject(await api.project.open());
    else if (c === 'save') saveProject(false); else if (c === 'saveAs') saveProject(true);
    else if (c === 'media') openFile(await api.openMedia());
    else if (c.startsWith('lang:')) setUiLang(c.slice(5));
    else if (c === 'close') { if (await confirmDiscard()) api.project.closeNow(); }
  });
  api.project.onOpen(p => loadProject(p));
  const first = await api.project.ready(); if (first) await loadProject(first, { skipConfirm: true });
}

// ---------- autotest (Linux/CI): mismo flujo que un usuario ----------
async function selfTest(cfg) {
  const res = { ok: false, steps: [] }; const log = (k, v) => { res.steps.push({ k, v }); console.log('SELFTEST', k, JSON.stringify(v)); };
  if (cfg.compare) {
    try {
      await openFile(cfg.compare.input); state.settings.maxLines = 2;
      document.querySelector('.tab[data-tab="style"]').click();
      for (const vr of cfg.compare.variants) {
        state.style = { ...S.DEFAULT_STYLE, ...vr.style }; $('#st-fontFamily').value = state.style.fontFamily; syncStyleUI();
        state.segs = [{ id: 'a', start: 0, end: 30, text: cfg.compare.text }];
        renderSegs(); const v = $('#video'); v.currentTime = 5; await new Promise(r => setTimeout(r, 700));
        await ensureMetrics(state.style); tick(); await new Promise(r => setTimeout(r, 300));
        const ob = $('#overlay').getBoundingClientRect();
        await api.test.shot(cfg.compare.out + vr.name + '-ui.png');
        const r = await burn(cfg.compare.out + vr.name + '.mp4');
        log('variant', { name: vr.name, ok: r && r.ok, overlay: [ob.x, ob.y, ob.width, ob.height], dpr: devicePixelRatio, out: r && [r.out.width, r.out.height] });
      }
      const C = cfg.compare;
      if (C.uiShots) {
        state.segs = [{ id: 'a', start: 0, end: 30, text: C.text }, { id: 'b', start: 30, end: 33, text: 'Segundo subtítulo' }]; renderSegs();
        for (const [l, tab] of [['en', 'subs'], ['en', 'style'], ['en', 'export'], ['en', 'settings'], ['es', 'subs'], ['es', 'settings']]) {
          setUiLang(l); document.querySelector(`.tab[data-tab="${tab}"]`).click(); await new Promise(r => setTimeout(r, 500));
          await api.test.shot(C.out + `ui-${l}-${tab}.png`);
          log('uiLang', { l, tab, tabs: [...document.querySelectorAll('.tab')].map(b => b.textContent).join('|'), status: $('#statusTxt').textContent.slice(0, 60) });
        }
        await api.test.menu(C.out + 'menu-es.png'); setUiLang('en'); await api.test.menu(C.out + 'menu-en.png'); setUiLang('auto');
      }
      if (C.overlays) for (const m of ['alpha', 'green', 'black']) {
        const r = await burn(C.out + 'ovl-' + m + (m === 'alpha' ? '.mov' : '.mp4'), m);
        log('overlay', { m, ok: r && r.ok, out: r && r.out, in: r && [r.in.width, r.in.height, r.in.fps, r.in.duration] });
      }
      if (C.project) {
        state.segs = [{ id: 'a', start: 0.5, end: 3, text: 'Primera línea del proyecto' }, { id: 'b', start: 3.2, end: 6, text: C.text }];
        state.settings.maxWords = 5; state.settings.lang = 'es'; $('#ovlSel').value = 'green'; $('#codecSel').value = 'hevc';
        renderSegs(); renderOverlay();
        document.querySelector('.tab[data-tab="export"]').click(); await new Promise(r => setTimeout(r, 900));
        log('dirtyBeforeSave', { dirty: isDirty(), title: document.title, name: $('#projName').textContent, dot: !$('#projDot').hidden });
        await api.test.shot(C.out + 'ui-dirty.png');
        const before = snap(); await saveProject(false, C.project);
        log('savedClean', { dirty: isDirty() });
        await newProject(); log('afterNew', { segs: state.segs.length, file: state.file });
        await loadProject(C.project, { skipConfirm: true });
        log('roundtrip', { identical: snap() === before, dirty: isDirty(), segs: state.segs.length, file: state.file });
        await loadProject(C.projMoved, { skipConfirm: true }); log('relative', { file: state.file, segs: state.segs.length });
        await loadProject(C.projLost, { skipConfirm: true, relink: true, relinkPath: C.input }); log('relink', { file: state.file, dirty: isDirty() });
        await saveProject(false); await new Promise(r => setTimeout(r, 800));
        log('menu', await api.test.menu(C.out + 'menu.png'));
      }
      res.ok = true;
    } catch (e) { log('error', String(e.stack || e)); }
    return api.test.done(res);
  }
  try {
    for (const job of cfg.jobs) {
      await openFile(job.input); log('probe', state.info);
      if (job.model) { state.settings.model = job.model; }
      state.settings.device = cfg.device || 'auto'; if (job.maxWords != null) state.settings.maxWords = 0; $('#langSel').value = job.lang || 'auto';
      await transcribe(); log('transcribe', { ...window.__lastTranscribe, segs: sorted().map(s => [s.start.toFixed(2), s.end.toFixed(2), s.text]) });
      if (!state.segs.length) throw new Error('sin segmentos');
      const stats = () => { const a = sorted(); const wc = a.map(x => x.text.split(/\s+/).filter(Boolean).length);
        return { cues: a.length, avgWords: +(wc.reduce((p, q) => p + q, 0) / a.length).toFixed(2), maxWords: Math.max(...wc), minDur: +Math.min(...a.map(x => x.end - x.start)).toFixed(2),
          overlaps: a.filter((x, i) => i && x.start < a[i - 1].end - 1e-6).length, monotonic: a.every((x, i) => x.end > x.start && (!i || x.start >= a[i - 1].start)),
          sample: a.slice(0, 6).map(x => `${x.start.toFixed(2)}-${x.end.toFixed(2)} ${x.text}`) }; };
      if (job.maxWords != null) {
        log('antes(auto)', stats());
        state.settings.maxWords = job.maxWords; $('#maxWordsSel').value = String(job.maxWords); resegmentAll(); log(`despues(${job.maxWords})`, stats());
        undo(); log('undo', { cues: state.segs.length }); resegmentAll();
      }
      await api.write(job.out + '.orig.srt', S.toSRT(sorted()));
      $('#trSel').value = 'auto'; await translate(); log('translate', sorted().map(s => s.text)); if (job.maxWords != null) log('traducido', stats());
      if (job.style) { state.style = { ...S.DEFAULT_STYLE, ...BUILTIN_PRESETS[job.style] || {}, ...(job.styleOverride || {}) }; $('#st-fontFamily').value = state.style.fontFamily; syncStyleUI(); }
      await api.write(job.out + '.srt', S.toSRT(sorted())); await api.write(job.out + '.ass', buildAss());
      const v = $('#video'); const s0 = sorted()[Math.min(1, state.segs.length - 1)]; v.currentTime = (s0.start + s0.end) / 2; await new Promise(r => setTimeout(r, 800)); tick();
      await ensureMetrics(state.style); renderOverlay();
      if (job.drag) { // simula arrastrar el subtítulo sobre la preview
        const el = document.querySelector('#overlay .sub'); const b = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: b.x + b.width / 2 + job.drag[0], clientY: b.y + b.height / 2 + job.drag[1] }));
        window.dispatchEvent(new MouseEvent('mouseup', {})); log('drag', { pos: state.style.position, x: state.style.customX, y: state.style.customY });
      }
      log('previewTime', { t: v.currentTime, vw: v.videoWidth, rs: v.readyState, err: v.error && v.error.message, ratio: fontRatio(state.style) });
      document.querySelector(`.tab[data-tab="${job.tab || 'subs'}"]`).click(); await new Promise(r => setTimeout(r, 300));
      await api.test.shot(job.shot || (job.out + '-ui.png'));
      $('#codecSel').value = job.codec || 'h264';
      const r = await burn(job.out + '.' + (job.codec === 'prores' ? 'mov' : 'mp4')); log('burn', { ok: r?.ok, seconds: r?.seconds, in: r && [r.in.width, r.in.height, r.in.fps], out: r && [r.out.width, r.out.height, r.out.fps], args: r?.args, error: r?.error });
      if (!r?.ok) throw new Error('burn falló');
    }
    res.ok = true;
  } catch (e) { log('error', String(e.stack || e)); }
  api.test.done(res);
}
init();
