const S = window.Subs; const api = window.api; const I18N = window.I18N; const t = I18N.t;
const $ = (s) => document.querySelector(s);
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) if (k === 'dataset') Object.assign(el.dataset, v); else el[k] = v;
  el.append(...children);
  return el;
}
const BUNDLED = ['Poppins', 'Lato', 'Anton', 'Bebas Neue', 'Lobster', 'Permanent Marker'];
const FALLBACK_SYS = ['Helvetica Neue', 'Helvetica', 'Arial', 'Avenir Next', 'Futura', 'Gill Sans', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Impact', 'Menlo'];

const state = {
  file: null, info: null, segs: [], sel: -1, lang: null,
  style: { ...S.DEFAULT_STYLE }, presets: {}, settings: { model: 'small', device: 'auto', lang: 'auto', maxWords: 7, maxLines: 2 },
  undo: [], sysFonts: [], busy: false,
};
document.body.classList.add('platform-' + api.platform);

function status(msg) { $('#statusTxt').textContent = msg; }
function progress(p, txt) {
  $('#progWrap').hidden = p == null; $('#progBar').style.width = ((p || 0) * 100).toFixed(1) + '%'; $('#progTxt').textContent = txt || '';
}
let toastT; function toast(msg, err) { const el = $('#toast'); el.textContent = msg; el.className = 'toast' + (err ? ' err' : ''); el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, err ? 7000 : 3500); }
const mb = (b) => (b / 1048576).toFixed(0) + ' MB';
function pushUndo() { state.undo.push(JSON.stringify(state.segs)); if (state.undo.length > 100) state.undo.shift(); }
function undo() { if (!state.undo.length) return; state.segs = JSON.parse(state.undo.pop()); renderSegs(); renderOverlay(); renderTimeline(); }
function setBusy(b) {
  state.busy = b;
  $('#btnTranscribe').disabled = b || !state.file;
  $('#btnTranslate').disabled = b || !state.segs.length;
  const hasSegs = state.segs.length > 0;
  $('#btnBurn').disabled = b || !hasSegs || !state.info?.hasVideo;
  $('#btnOverlay').disabled = b || !hasSegs || !state.info?.hasVideo;
  $('#btnSrt').disabled = !hasSegs; $('#btnAss').disabled = !hasSegs;
}

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

const cvs = document.createElement('canvas').getContext('2d');
function fontCss(st, px) { return `${st.italic ? 'italic ' : ''}${st.bold ? '700 ' : '400 '}${px}px "${st.fontFamily}"`; }
const BUNDLED_FILES = { 'Poppins': ['Poppins-Regular', 'Poppins-Bold', 'Poppins-Italic', 'Poppins-BoldItalic'], 'Lato': ['Lato-Regular', 'Lato-Bold', 'Lato-Italic', 'Lato-BoldItalic'],
  'Anton': ['Anton-Regular'], 'Bebas Neue': ['BebasNeue-Regular'], 'Lobster': ['Lobster-Regular'], 'Permanent Marker': ['PermanentMarker-Regular'] };
const metricCache = new Map();
const metricKey = (st) => `${st.fontFamily}|${st.bold}|${st.italic}`;
function parseWinMetrics(buf) {
  const dv = new DataView(buf); let base = 0;
  if (dv.getUint32(0) === 0x74746366) base = dv.getUint32(12);
  const n = dv.getUint16(base + 4); const tb = {};
  for (let i = 0; i < n; i++) { const o = base + 12 + i * 16; tb[String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3))] = dv.getUint32(o + 8); }
  const upm = dv.getUint16(tb.head + 18);
  if (tb['OS/2'] != null) { const a = dv.getUint16(tb['OS/2'] + 74), d = dv.getUint16(tb['OS/2'] + 76); if (a + d) return { ratio: (a + d) / upm, asc: a / upm }; }
  if (tb.hhea != null) { const a = dv.getInt16(tb.hhea + 4), d = dv.getInt16(tb.hhea + 6); return { ratio: (a - d) / upm, asc: a / upm }; }
  return null;
}
async function ensureMetrics(st) {
  const key = metricKey(st); if (metricCache.has(key)) return metricCache.get(key);
  let r = null;
  try {
    const files = Object.hasOwn(BUNDLED_FILES, st.fontFamily) ? BUNDLED_FILES[st.fontFamily] : null;
    if (files) {
      const pick = files.length === 4 ? files[(st.bold ? 1 : 0) + (st.italic ? 2 : 0)] : files[0];
      r = parseWinMetrics(await (await fetch(`/fonts/${pick}.ttf`)).arrayBuffer());
    } else if (state.localFonts) {
      const cands = state.localFonts.filter(f => f.family === st.fontFamily);
      const want = (st.bold ? 'bold' : '') + (st.italic ? 'italic' : '');
      const f = cands.find(f => f.style.toLowerCase().replace(/\s|oblique/g, m => m === 'oblique' ? 'italic' : '') === (want || 'regular')) || cands[0];
      if (f) r = parseWinMetrics(await (await f.blob()).arrayBuffer());
    }
  } catch (e) { console.warn('métricas', e); }
  metricCache.set(key, r); return r;
}
function baselineShift(st, ratio) {
  const m0 = metricCache.get(metricKey(st)); if (!m0) return 0;
  cvs.font = fontCss(st, 100); const m = cvs.measureText('Hg');
  const A = m.fontBoundingBoxAscent / 100, D = m.fontBoundingBoxDescent / 100;
  return m0.asc - ((ratio - (A + D)) / 2 + A);
}
function fontRatio(st) {
  const k = metricKey(st); const known = metricCache.get(k);
  if (known) return known.ratio;
  if (!metricCache.has(k)) ensureMetrics(st).then(() => renderOverlay());
  cvs.font = fontCss(st, 100); const m = cvs.measureText('Hg');
  const r = (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / 100;
  return r > 0.5 && r < 3 ? r : 1.2;
}
function measureFn(st, px) { cvs.font = fontCss(st, px); return (txt) => cvs.measureText(txt).width; }
function layoutSegs(segs, st, W, H) {
  const g = S.geometry(st, W, H); const meas = measureFn(st, g.fontPx);
  return segs.map(s => ({ ...s, lines: s.text.split(/\n/).flatMap(p => S.wrap(p, g.maxW - g.outline * 2, meas)) }));
}
function dims() { const i = state.info; return i && i.width ? [i.width, i.height] : [1920, 1080]; }
function buildAss() { const [W, H] = dims(); return S.buildASS(layoutSegs(sorted(), state.style, W, H), state.style, W, H, { fontScale: fontRatio(state.style) }); }
const sorted = () => [...state.segs].sort((a, b) => a.start - b.start);

async function openFile(p) {
  if (!p) return;
  if (/\.subtitulador$/i.test(p)) return loadProject(p);
  status(t('Analizando archivo…'));
  let info;
  try { info = await api.probe(p); } catch { toast(t('No pude leer ese archivo.'), true); return; }
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
    state.lastTranscribe = { wordTimestamps: state.wordTimestamps, seconds: secs, audioSeconds: r.seconds, device: r.device, lang: state.lang };
    renderSegs(); renderOverlay(); renderTimeline();
  } catch (e) { console.error(e); toast(t('Error al transcribir: {e}', { e: e.message.split('\n')[0] }), true); status(t('Error al transcribir.')); }
  finally { progress(null); setBusy(false); }
}

function fitsFn() {
  const [W, H] = dims(); const st = state.style; const g = S.geometry(st, W, H); const meas = measureFn(st, g.fontPx);
  const maxL = +state.settings.maxLines || 2;
  return (txt) => S.wrap(txt, g.maxW - g.outline * 2, meas).length <= maxL;
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

async function translate() {
  if (!state.segs.length || state.busy) return;
  let dir = $('#trSel').value;
  if (dir === 'auto') { const l = state.lang || S.guessLang(state.segs.map(s => s.text).join(' ')); dir = l === 'es' ? 'es-en' : 'en-es'; }
  setBusy(true);
  try {
    status(t('Traduciendo ({dir})…', { dir: t(dir === 'en-es' ? 'inglés → español' : 'español → inglés') }));
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

function renderSegs() {
  const list = $('#segList');
  const segs = sorted(); state.segs = segs;
  $('#segCount').textContent = segs.length ? t('{n} subtítulos', { n: segs.length }) : '';
  if (!segs.length) list.replaceChildren(h('p', { className: 'hint', textContent: t('Todavía no hay subtítulos. Transcribí el audio o agregalos a mano con “＋ Agregar en el cursor”.') }));
  else list.replaceChildren();
  segs.forEach((s, i) => {
    const btn = (a, label, title) => h('button', { textContent: label, title: t(title), dataset: { a } });
    const el = h('div', { className: 'seg' + (i === state.sel ? ' sel' : ''), dataset: { id: s.id } },
      h('div', { className: 'num', textContent: String(i + 1) }),
      h('div', { className: 'times' },
        btn('go', '▶', 'Ir a este subtítulo'),
        h('input', { className: 't-start', value: S.fmtClock(s.start), title: t('Inicio') }), btn('setStart', '⇤', 'Inicio = cursor'),
        h('span', { className: 'muted', textContent: '→' }),
        h('input', { className: 't-end', value: S.fmtClock(s.end), title: t('Fin') }), btn('setEnd', '⇥', 'Fin = cursor'),
        h('span', { className: 'spacer' }), btn('del', '✕', 'Borrar')),
      h('textarea', { rows: 2 }));
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
    el.addEventListener('click', (e) => { if (e.target.closest('button')) return; if (state.sel !== i) { state.sel = i; markSel(); } });
    list.appendChild(el);
  });
  setBusy(state.busy);
}
function jumpTo(i) {
  const segs = sorted(); const s = segs[i]; if (!s) return;
  const v = $('#video'); v.currentTime = s.start + 0.01;
  state.sel = i; markSel();
  const tab = document.querySelector('.tab[data-tab="subs"]'); if (tab && !tab.classList.contains('active')) tab.click();
  const el = document.querySelectorAll('.seg')[i]; if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  const ta = el.querySelector('textarea'); ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length);
}
function markSel() { document.querySelectorAll('.seg').forEach((el, i) => el.classList.toggle('sel', i === state.sel)); renderTimeline(); }
function addSeg() {
  const now = $('#video').currentTime || 0; pushUndo();
  const next = sorted().find(s => s.start > now);
  const seg = { id: crypto.randomUUID(), start: now, end: Math.min(now + 2.5, next ? next.start : now + 2.5) || now + 2.5, text: t('Nuevo subtítulo') };
  if (seg.end - seg.start < 0.3) seg.end = now + 1;
  state.segs.push(seg); renderSegs();
  const idx = sorted().indexOf(seg); state.sel = idx; markSel();
  const ta = document.querySelectorAll('.seg textarea')[idx]; ta?.focus(); ta?.select(); ta?.scrollIntoView({ block: 'center' });
  renderOverlay();
}

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
  const ov = $('#overlay'); const now = $('#video').currentTime || 0; const st = state.style; const [W, H] = dims();
  const active = layoutSegs(sorted().filter(s => now >= s.start && now < s.end && s.text.trim()), st, W, H);
  document.querySelectorAll('.seg').forEach(el => { const s = state.segs.find(x => x.id === el.dataset.id); el.classList.toggle('active', !!s && now >= s.start && now < s.end); });
  ov.replaceChildren();
  const g = S.geometry(st, W, H); const k = vbox.sc || 1; const ratio = fontRatio(st);
  const bshift = baselineShift(st, ratio) * g.fontPx;
  const lineH = g.fontPx * ratio;
  for (const s of active) {
    const pos = S.linePositions(g, s.lines.length, lineH);
    const top = Math.min(...pos.map(p => p.an === 2 ? p.y - lineH : p.an === 8 ? p.y : p.y - lineH / 2));
    const d = document.createElement('div'); d.className = 'sub' + (st.box ? ' boxed' : ''); d.dataset.id = s.id; if (editing && editing.dataset.id === s.id) d.classList.add('editing'); d.title = t('Doble clic para editar');
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
        if (g.shadow > 0 || g.blur > 0) l.style.textShadow = `${g.shadow * k}px ${g.shadow * k}px ${g.blur * 2 * k}px ${hexA(st.shadowColor, st.shadowOpacity)}`;
      }
      d.appendChild(l);
    });
    d.addEventListener('mousedown', startDrag); d.addEventListener('dblclick', inlineEdit);
    ov.appendChild(d);
  }
}
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

let editing = null;
function cleanEdit(text) { return text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'); }
function inlineEdit(e) {
  e.preventDefault(); e.stopPropagation(); if (editing) return;
  const seg = state.segs.find(x => x.id === e.currentTarget.dataset.id); if (!seg) return;
  const pl = $('#player'); const pr = pl.getBoundingClientRect(); const d = e.currentTarget;
  const rs = [...d.children].map(x => x.getBoundingClientRect()); const cx = d.getBoundingClientRect().left;
  const top = Math.min(...rs.map(r => r.top)); const span = Math.max(...rs.map(r => Math.max(cx - r.left, r.right - cx)));
  const st = state.style; const [W, H] = dims(); const g = S.geometry(st, W, H); const k = vbox.sc || 1;
  const v = $('#video'); v.pause();
  const w = Math.min(pr.width - 16, Math.max(2 * span + 24, g.maxW * k + 24, 160)); const left = Math.max(8, Math.min(pr.width - w - 8, cx - pr.left - w / 2));
  const ta = h('textarea', { className: 'inline-edit', spellcheck: true, title: t('Enter guarda · Shift+Enter nueva línea · Esc cancela') });
  ta.value = seg.text; ta.dataset.id = seg.id;
  Object.assign(ta.style, { transform: `translate(${left}px, ${Math.max(4, Math.min(pr.height - 40, top - pr.top - 6))}px)`, width: w + 'px', font: fontCss(st, g.fontPx * k), color: st.color, lineHeight: (g.fontPx * k * fontRatio(st)) + 'px' });
  pl.appendChild(ta);
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }; fit();
  ta.focus(); ta.select();
  const finish = (save) => {
    if (editing !== ta) return; editing = null;
    document.removeEventListener('mousedown', outside, true); ta.remove();
    const txt = cleanEdit(ta.value);
    if (save && txt && txt !== seg.text) {
      pushUndo(); seg.text = txt; seg.words = null;
      state.sel = sorted().indexOf(seg); renderSegs(); renderTimeline(); refreshDirty();
    }
    renderOverlay();
  };
  const outside = (ev) => { if (ev.target !== ta) finish(true); };
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); finish(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
  });
  ta.addEventListener('blur', () => finish(true));
  editing = ta; renderOverlay(); document.addEventListener('mousedown', outside, true);
}
function renderTimeline() {
  const tl = $('#timeline'); const dur = state.info?.duration || $('#video').duration || 1;
  tl.querySelectorAll('.blk').forEach(b => b.remove());
  sorted().forEach((s, i) => {
    const b = document.createElement('div'); b.className = 'blk' + (i === state.sel ? ' sel' : '');
    b.style.left = (s.start / dur * 100) + '%'; b.style.width = Math.max(0.3, (s.end - s.start) / dur * 100) + '%'; b.textContent = s.text;
    b.dataset.i = String(i); b.title = t('Clic para ir a este subtítulo');
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
  try { if (window.queryLocalFonts) { const list = await window.queryLocalFonts(); state.localFonts = list; sys = [...new Set(list.map(f => f.family).filter(f => typeof f === 'string' && f.length <= 80))].sort((a, b) => a.localeCompare(b)); } } catch (e) { console.warn('queryLocalFonts', e); }
  if (!sys.length) sys = FALLBACK_SYS;
  state.sysFonts = sys;
  sel.replaceChildren(optGroup(t('Incluidas (Google Fonts)'), BUNDLED), optGroup(t('Del sistema'), sys.filter(f => !BUNDLED.includes(f))));
  sel.value = state.style.fontFamily;
  await Promise.all(BUNDLED.map(f => document.fonts.load(`700 20px "${f}"`).catch(() => {})));
}
function option(value, label) { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; }
function optGroup(label, values) { const g = document.createElement('optgroup'); g.label = label; g.append(...values.map(v => option(v, v))); return g; }
function cleanPresets(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const n of Object.keys(o).slice(0, 200)) if (typeof n === 'string' && n.length <= 80 && n !== '__proto__') out[n] = S.cleanStyle(o[n]);
  return out;
}
const withIds = (segs) => segs.map(s => ({ ...s, id: s.id || crypto.randomUUID() }));
function renderPresets() {
  const sel = $('#presetSel'); const names = Object.keys(state.presets);
  sel.replaceChildren(option('', t('— Presets guardados ({n}) —', { n: names.length })), ...names.map(n => option(n, Object.hasOwn(BUILTIN_PRESETS, n) ? t(n) : n)));
}
const BUILTIN_PRESETS = {
  'Clásico (borde negro)': { ...S.DEFAULT_STYLE },
  'Caja oscura': { ...S.DEFAULT_STYLE, fontFamily: 'Lato', bold: false, box: true, boxOpacity: 0.65, shadow: false },
  'Redes (amarillo grande)': { ...S.DEFAULT_STYLE, fontFamily: 'Anton', bold: false, fontSize: 8, color: '#FFE14D', outlineWidth: 0.5, position: 'middle', maxWidth: 70 },
};

let saveT; function saveStore() { clearTimeout(saveT); saveT = setTimeout(() => api.storeSet({ style: state.style, presets: state.presets, settings: state.settings }), 300); }

function baseName() { return state.file ? state.file.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : 'subtitulos'; }
function mediaDir() { return state.file ? state.file.replace(/[\\/][^\\/]*$/, '') : null; }
const saveAs = (name, ext) => api.save({ dir: mediaDir(), name: `${name}.${ext}`, ext });
async function exportText(kind) {
  await ensureMetrics(state.style);
  const text = kind === 'srt' ? S.toSRT(sorted()) : buildAss();
  const p = await saveAs(baseName(), kind);
  if (!p) return; await api.write(p, text); toast(t('Guardado: {f}', { f: p.split(/[\\/]/).pop() }));
  return p;
}
async function systemFontFiles() {
  const fam = state.style.fontFamily; if (BUNDLED.includes(fam) || !state.localFonts) return [];
  const out = [];
  for (const f of state.localFonts.filter(f => f.family === fam)) {
    try { const b = await f.blob(); out.push({ data: new Uint8Array(await b.arrayBuffer()) }); } catch (e) { console.warn('fuente', e); }
  }
  return out;
}
async function burn(outPath, overlay) {
  const codec = $('#codecSel').value; const ext = overlay ? (overlay === 'alpha' ? 'mov' : 'mp4') : codec === 'prores' ? 'mov' : 'mp4';
  const p = outPath || await saveAs(`${baseName()}-${overlay ? 'solo-subs' + (overlay === 'alpha' ? '' : '-' + overlay) : 'subtitulado'}`, ext);
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

function bind() {
  $('#btnOpen').onclick = async () => openFile(await api.openMedia());
  $('#btnTranscribe').onclick = transcribe; $('#btnTranslate').onclick = translate;
  $('#btnReseg').onclick = resegmentAll;
  $('#maxWordsSel').onchange = (e) => { state.settings.maxWords = +e.target.value; saveStore(); };
  $('#maxLinesSel').onchange = (e) => { state.settings.maxLines = +e.target.value; saveStore(); };
  $('#btnAdd').onclick = addSeg; $('#btnUndo').onclick = undo;
  $('#btnImport').onclick = async () => { const txt = await api.openSubs(); if (!txt) return; pushUndo(); state.segs = withIds(S.cleanSegs(S.parseSRT(txt))); renderSegs(); renderOverlay(); renderTimeline(); };
  $('#btnSrt').onclick = () => exportText('srt'); $('#btnAss').onclick = () => exportText('ass');
  $('#uiLangSel').onchange = (e) => setUiLang(e.target.value);
  $('#btnBurn').onclick = () => burn(); $('#btnOverlay').onclick = () => burn(null, $('#ovlSel').value); $('#btnCancel').onclick = () => api.cancelExport();
  const v = $('#video');
  $('#btnPlay').onclick = () => v.paused ? v.play() : v.pause();
  v.addEventListener('timeupdate', tick); v.addEventListener('seeked', tick); v.addEventListener('loadedmetadata', () => { tick(); renderTimeline(); });
  const loop = () => { if (!v.paused) tick(); requestAnimationFrame(loop); }; loop();
  const sk = $('#seek'); sk.oninput = () => { seeking = true; v.currentTime = (v.duration || 0) * sk.value / 1000; }; sk.onchange = () => seeking = false;
  const tl = $('#timeline'); let down = null;
  tl.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  tl.addEventListener('click', (e) => {
    const moved = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4; down = null; if (moved) return;
    const b = e.target.closest('.blk');
    if (b) { jumpTo(+b.dataset.i); return; }
    const r = tl.getBoundingClientRect(); v.currentTime = (v.duration || 0) * (e.clientX - r.left) / r.width;
  });
  document.querySelectorAll('.tab').forEach(tab => tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab.dataset.tab));
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
  $('#modelSel').onchange = (e) => { state.settings.model = e.target.value; saveStore(); };
  $('#deviceSel').onchange = (e) => { state.settings.device = e.target.value; saveStore(); };
  $('#langSel').onchange = (e) => { state.settings.lang = e.target.value; saveStore(); };
  const crf = $('#crf'); const crfOut = () => crf.nextElementSibling.textContent = crf.value; crf.oninput = crfOut; crfOut();
  $('#codecSel').onchange = (e) => { const pr = e.target.value === 'prores'; $('#crfRow').hidden = pr; $('#presetRow').hidden = pr; if (e.target.value === 'hevc' && +crf.value === 15) { crf.value = 17; crfOut(); } };
  $('#presetSel').onchange = (e) => { const p = Object.hasOwn(state.presets, e.target.value) ? state.presets[e.target.value] : null; if (p) { state.style = S.cleanStyle(p); $('#st-fontFamily').value = state.style.fontFamily; syncStyleUI(); renderOverlay(); saveStore(); } };
  $('#btnPresetSave').onclick = () => { const n = $('#presetName').value.trim().slice(0, 80); if (!n || n === '__proto__') { toast(t('Poné un nombre para el preset.')); return; } state.presets[n] = { ...state.style }; renderPresets(); $('#presetSel').value = n; $('#presetName').value = ''; saveStore(); toast(t('Preset “{n}” guardado', { n })); };
  $('#btnPresetDel').onclick = () => { const n = $('#presetSel').value; if (!n) return; delete state.presets[n]; renderPresets(); saveStore(); };
}

async function init() {
  const saved = await api.storeGet();
  state.style = S.cleanStyle(saved.style);
  state.presets = saved.presets ? cleanPresets(saved.presets) : { ...BUILTIN_PRESETS };
  state.settings = S.cleanSettings(saved.settings, state.settings);
  $('#modelSel').value = state.settings.model; $('#deviceSel').value = state.settings.device; $('#langSel').value = state.settings.lang; $('#maxWordsSel').value = String(state.settings.maxWords); $('#maxLinesSel').value = String(state.settings.maxLines);
  applyUiLang();
  bind(); bindStyleUI(); await loadFonts(); syncStyleUI(); renderPresets(); renderSegs(); layoutOverlay();
  const gpu = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
  state.gpu = !!gpu; renderAbout();
  initProject();
  const cfg = await api.test.config();
  if (cfg) (await import('./selftest.js')).selfTest(cfg, { state, S, $, api, openFile, syncStyleUI, renderSegs, renderOverlay, renderTimeline, jumpTo, ensureMetrics, tick, burn, setUiLang, isDirty, snap, saveProject, newProject, loadProject, transcribe, sorted, resegmentAll, undo, translate, buildAss, fontRatio, BUILTIN_PRESETS });
}

function renderAbout() { $('#aboutTxt').textContent = t('Subtitulador {v} · Whisper + Opus-MT (transformers.js) · ffmpeg + libass.', { v: APP_VERSION }) + t(state.gpu ? ' · GPU (WebGPU) disponible ✔' : ' · WebGPU no disponible: se usa CPU (WASM).'); }
const APP_VERSION = '1.3.2';
function applyUiLang() {
  const pref = state.settings.uiLang || 'auto';
  I18N.setLang(pref === 'auto' ? I18N.systemLang(navigator.language) : pref);
  I18N.apply(document); $('#uiLangSel').value = pref;
  api.setUiLang(I18N.getLang());
}
function setUiLang(pref) {
  state.settings.uiLang = pref; saveStore(); applyUiLang();
  const sel = $('#statusTxt'); if (sel && !sel.textContent.trim()) sel.textContent = t('Listo.');
  renderAbout(); renderPresets(); loadFonts(); renderSegs(); renderTimeline(); renderOverlay(); lastDirty = null; refreshDirty();
  if (!state.file) $('#fileName').textContent = t('Ningún archivo abierto — también podés arrastrarlo acá');
}

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
  if (!p) p = await saveAs(state.file ? baseName() : projName(), 'subtitulador');
  if (!p) return false;
  await api.project.write(p, projectData()); proj.path = p; markSaved(); toast(t('Proyecto guardado ✔')); return true;
}
function applyExport(x) {
  if (!x) return;
  $('#codecSel').value = x.codec; $('#codecSel').onchange({ target: $('#codecSel') });
  $('#crf').value = x.crf; $('#crf').dispatchEvent(new Event('input')); $('#encPreset').value = x.preset; $('#ovlSel').value = x.overlay;
}
async function loadProject(p, opts = {}) {
  if (!p) return false; if (!opts.skipConfirm && !await confirmDiscard()) return false;
  let d; try { d = await api.project.read(p); } catch (e) { toast(t('No pude abrir el proyecto: {e}', { e: e.message }), true); return false; }
  let media = d.media && d.media.resolved;
  if (d.media && d.media.path && !media) {
    const r = opts.relink !== undefined ? (opts.relink ? 0 : 1) : await api.project.confirm({ message: t('No encuentro el video del proyecto.'), detail: t('Estaba en:\n{p}\n\n¿Querés buscarlo (por si lo moviste)?', { p: d.media.path }), buttons: [t('Buscar video…'), t('Abrir sin video')], cancelId: 1 });
    if (r === 0) media = opts.relinkPath || await api.openMedia();
  }
  state.style = S.cleanStyle(d.style); state.settings = S.cleanSettings(d.settings, state.settings); state.lang = d.lang === 'es' || d.lang === 'en' ? d.lang : null;
  state.segs = withIds(S.cleanSegs(d.segs)); state.undo = []; state.sel = -1;
  $('#maxWordsSel').value = String(state.settings.maxWords); $('#maxLinesSel').value = String(state.settings.maxLines); $('#langSel').value = state.settings.lang;
  $('#modelSel').value = state.settings.model; $('#deviceSel').value = state.settings.device; applyExport(S.cleanExport(d.export));
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

init();
