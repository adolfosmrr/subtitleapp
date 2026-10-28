// Lógica compartida de subtítulos: tiempos, SRT, ASS, estilos.
// Se usa en el renderer (<script>) y en Node (require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Subs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_STYLE = {
    fontFamily: 'Poppins', fontSize: 6.5, /* % de la altura del video */
    color: '#FFFFFF', bold: true, italic: false,
    outlineColor: '#000000', outlineWidth: 0.35, /* % altura */
    shadow: true, shadowColor: '#000000', shadowOpacity: 0.6, shadowOffset: 0.25,
    shadowType: 'solid', /* solid | blur */ shadowBlur: 0.4, /* % altura */
    lineHeight: 1.0, /* x alto de línea de la fuente */
    box: false, boxColor: '#000000', boxOpacity: 0.6, boxPadding: 0.6,
    position: 'bottom', /* bottom | middle | top | custom */
    marginV: 6, /* % altura (bottom/top) */
    offsetX: 0, offsetY: 0, /* % (desplazamiento extra) */
    customX: 50, customY: 85, /* % (modo custom: ancla centro-abajo) */
    maxWidth: 80, /* % del ancho */
  };

  const pad = (n, l = 2) => String(n).padStart(l, '0');
  function fmtSrtTime(t) {
    t = Math.max(0, t); const ms = Math.round(t * 1000);
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  }
  function fmtAssTime(t) {
    t = Math.max(0, t); const cs = Math.round(t * 100);
    return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
  }
  function fmtClock(t) { // para la UI: 00:01:02.345
    return fmtSrtTime(t).replace(',', '.');
  }
  function parseClock(s) {
    const m = String(s).trim().replace(',', '.').match(/^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/);
    if (!m) return NaN;
    const parts = [m[1], m[2], m[3]].filter(x => x !== undefined).map(Number);
    let t = 0; for (const p of parts) t = t * 60 + p; return t;
  }

  function toSRT(segs) {
    return segs.map((s, i) => `${i + 1}\n${fmtSrtTime(s.start)} --> ${fmtSrtTime(s.end)}\n${(s.lines || [s.text]).join('\n')}\n`).join('\n');
  }
  function parseSRT(txt) {
    const out = [];
    for (const block of txt.replace(/\r/g, '').split(/\n\s*\n/)) {
      const lines = block.trim().split('\n'); const i = lines.findIndex(l => l.includes('-->'));
      if (i < 0) continue;
      const [a, b] = lines[i].split('-->').map(x => parseClock(x.trim().split(' ')[0]));
      out.push({ start: a, end: b, text: lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim() });
    }
    return out;
  }

  // '#RRGGBB' + opacidad (0..1) -> &HAABBGGRR
  function assColor(hex, opacity = 1) {
    const h = hex.replace('#', '');
    const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
    const a = Math.round((1 - opacity) * 255).toString(16).padStart(2, '0');
    return `&H${a}${b}${g}${r}`.toUpperCase();
  }
  function escAss(t) { return t.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}'); }

  // Corta texto en líneas que no superen maxPx, usando measure(text)->px
  function wrap(text, maxPx, measure) {
    const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
    const lines = []; let cur = '';
    for (const w of words) {
      const cand = cur ? cur + ' ' + w : w;
      if (cur && measure(cand) > maxPx) { lines.push(cur); cur = w; } else cur = cand;
    }
    if (cur) lines.push(cur);
    // balanceo simple de 2 líneas
    if (lines.length === 2) {
      const all = words; let best = null;
      for (let k = 1; k < all.length; k++) {
        const a = all.slice(0, k).join(' '), b = all.slice(k).join(' ');
        const wa = measure(a), wb = measure(b);
        if (wa > maxPx || wb > maxPx) continue;
        const sc = Math.max(wa, wb); if (!best || sc < best.sc) best = { sc, l: [a, b] };
      }
      if (best) return best.l;
    }
    return lines.length ? lines : [''];
  }

  // Geometría en píxeles del video (compartida entre preview y ASS)
  function geometry(style, W, H) {
    const px = v => v / 100 * H;
    const g = {
      fontPx: px(style.fontSize), outline: style.box ? px(style.boxPadding) : px(style.outlineWidth),
      shadow: style.shadow ? px(style.shadowOffset) : 0, blur: style.shadow && style.shadowType === 'blur' ? px(style.shadowBlur ?? 0.4) : 0,
      lh: style.lineHeight || 1, maxW: style.maxWidth / 100 * W,
    };
    const dx = style.offsetX / 100 * W, dy = style.offsetY / 100 * H;
    if (style.position === 'custom') { g.an = 2; g.x = style.customX / 100 * W; g.y = style.customY / 100 * H; }
    else if (style.position === 'top') { g.an = 8; g.x = W / 2 + dx; g.y = px(style.marginV) + dy; }
    else if (style.position === 'middle') { g.an = 5; g.x = W / 2 + dx; g.y = H / 2 + dy; }
    else { g.an = 2; g.x = W / 2 + dx; g.y = H - px(style.marginV) + dy; }
    return g;
  }

  // Posición de cada línea (cada línea es su propio evento ASS => interlineado controlable).
  // lineH = alto de línea de libass (= tamaño ASS). Devuelve [{an, x, y}] con el mismo ancla que la alineación.
  function linePositions(g, n, lineH) {
    const step = lineH * (g.lh || 1); const out = [];
    for (let i = 0; i < n; i++) {
      let y;
      if (g.an === 2) y = g.y - (n - 1 - i) * step;
      else if (g.an === 8) y = g.y + i * step;
      else y = g.y - (n - 1) * step / 2 + i * step;
      out.push({ an: g.an, x: g.x, y });
    }
    return out;
  }

  // fontScale: tamaño ASS = px * fontScale (ASS mide alto ascender+descender, CSS mide em)
  function buildASS(segs, style, W, H, opts = {}) {
    const g = geometry(style, W, H);
    const assSize = g.fontPx * (opts.fontScale || 1);
    const back = style.box ? assColor(style.boxColor, style.boxOpacity) : assColor(style.shadowColor, style.shadowOpacity);
    const outlineCol = style.box ? assColor(style.boxColor, style.boxOpacity) : assColor(style.outlineColor, 1);
    const st = [
      'Default', style.fontFamily, assSize.toFixed(2), assColor(style.color, 1), assColor(style.color, 1), outlineCol, back,
      style.bold ? -1 : 0, style.italic ? -1 : 0, 0, 0, 100, 100, 0, 0, style.box ? 3 : 1,
      g.outline.toFixed(2), (style.box || g.blur ? 0 : g.shadow).toFixed(2), g.an, 0, 0, 0, 1,
    ].join(',');
    const T = (s) => `${fmtAssTime(s.start)},${fmtAssTime(s.end)}`;
    const shCol = assColor(style.shadowColor, 1).slice(4), shA = Math.round((1 - style.shadowOpacity) * 255).toString(16).padStart(2, '0').toUpperCase();
    const ev = [];
    for (const s of segs.filter(s => s.end > s.start && (s.text || '').trim())) {
      const lines = s.lines || [s.text]; const pos = linePositions(g, lines.length, assSize);
      lines.forEach((ln, i) => {
        const p = pos[i];
        if (g.blur && !style.box && g.shadow >= 0) // sombra difuminada: capa inferior con el texto+borde en color de sombra, desplazada y con \blur
          ev.push(`Dialogue: 0,${T(s)},Default,,0,0,0,,{\\an${p.an}\\pos(${(p.x + g.shadow).toFixed(1)},${(p.y + g.shadow).toFixed(1)})\\1c&H${shCol}&\\3c&H${shCol}&\\1a&H${shA}&\\3a&H${shA}&\\shad0\\blur${g.blur.toFixed(2)}}${escAss(ln)}`);
        ev.push(`Dialogue: 1,${T(s)},Default,,0,0,0,,{\\an${p.an}\\pos(${p.x.toFixed(1)},${p.y.toFixed(1)})}${escAss(ln)}`);
      });
    }
    return `[Script Info]
; Generado por Subtitulador
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ${st}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join('\n')}
`;
  }

  // Parte segmentos largos de Whisper en subtítulos legibles (máx. 2 líneas)
  function splitLong(segs, maxChars = 84, maxDur = 6) {
    const out = [];
    for (const s of segs) {
      const text = s.text.trim(); if (!text) continue;
      const dur = s.end - s.start;
      if (text.length <= maxChars && dur <= maxDur + 1) { out.push({ ...s, text }); continue; }
      const words = text.split(/\s+/); const n = Math.max(Math.ceil(text.length / maxChars), Math.ceil(dur / maxDur));
      const per = Math.ceil(words.length / n); let t = s.start; const total = text.length;
      for (let i = 0; i < words.length; i += per) {
        const chunk = words.slice(i, i + per).join(' ');
        const d = dur * (chunk.length + 1) / (total + 1);
        out.push({ start: t, end: Math.min(s.end, t + d), text: chunk }); t += d;
      }
    }
    return out;
  }

  // Detección simple de idioma por palabras frecuentes
  function guessLang(text) {
    const w = (text.toLowerCase().match(/[a-záéíóúñü']+/g) || []);
    const es = new Set('el la los las de que y en un una por con para es no se lo al del como pero más su sus le ya muy está fue era'.split(' '));
    const en = new Set('the and of to a in that is was he it for with as his on be at by i you not this but had are'.split(' '));
    let e = 0, s = 0; for (const x of w) { if (es.has(x)) s++; if (en.has(x)) e++; }
    if (/[ñáéíóú¿¡]/.test(text)) s += 2;
    return s > e ? 'es' : 'en';
  }

  // Palabras con tiempo estimado: reparte el tramo [start,end] según el largo (caracteres) de cada palabra
  function spreadWords(text, start, end) {
    const ws = String(text).trim().split(/\s+/).filter(Boolean); if (!ws.length) return [];
    const tot = ws.reduce((a, w) => a + w.length + 1, 0); let t = start; const d = Math.max(0.01, end - start);
    return ws.map(w => { const dur = d * (w.length + 1) / tot; const o = { text: w, start: t, end: t + dur, est: true }; t += dur; return o; });
  }
  function wordsFromSegs(segs) {
    return [...segs].sort((a, b) => a.start - b.start).flatMap(s => s.words && s.words.length ? s.words : spreadWords(s.text, s.start, s.end));
  }
  const ENDP = /[.!?…;:]["»”')\]]*$/, COMMA = /[,—–]["»”')\]]*$/;
  // Arma cues a partir de palabras. maxWords=0 => sin límite (solo corta por puntuación/pausas/2 líneas).
  // fits(text) opcional: false si el texto no entra en las líneas permitidas.
  function resegment(words, { maxWords = 7, fits = null, minDur = 0.7, maxDur = 7 } = {}) {
    const lim = maxWords > 0 ? maxWords : 40; const cues = []; let cur = [];
    const flush = () => { if (cur.length) cues.push(cur); cur = []; };
    for (let i = 0; i < words.length; i++) {
      const w = words[i]; const prev = cur[cur.length - 1];
      if (prev && (w.start - prev.end > 0.7 || w.start - cur[0].start > maxDur)) flush();
      if (cur.length && fits && !fits([...cur, w].map(x => x.text).join(' '))) flush();
      cur.push(w);
      const n = cur.length; const t = w.text;
      if (n >= lim) {
        // preferir cortar en la última puntuación de la segunda mitad del cue
        let k = -1; for (let j = n - 2; j >= Math.ceil(lim * 0.5) - 1; j--) if (ENDP.test(cur[j].text) || COMMA.test(cur[j].text)) { k = j; break; }
        if (k >= 0) { const rest = cur.slice(k + 1); cur = cur.slice(0, k + 1); flush(); cur = rest; } else flush();
      }
      else if (ENDP.test(t) && (n >= 2 || (words[i + 1] && words[i + 1].start - w.end > 0.3))) flush();
      else if (COMMA.test(t) && n >= Math.max(2, Math.ceil(lim * 0.7))) flush();
      else if (ENDP.test(t) && maxWords <= 0) flush();
    }
    flush();
    // rebalanceo: un cue de 1 palabra después de uno lleno toma una palabra del anterior (si no hay puntuación entre medio)
    for (let i = 1; i < cues.length; i++) if (cues[i].length === 1 && cues[i - 1].length >= 3 && !ENDP.test(cues[i - 1][cues[i - 1].length - 1].text)) cues[i].unshift(cues[i - 1].pop());
    // evitar cue final huérfano de 1 palabra: unirlo al anterior si entra
    const out = cues.map(c => ({ start: c[0].start, end: c[c.length - 1].end, text: c.map(x => x.text).join(' '), words: c }));
    for (let i = 0; i < out.length; i++) {
      const c = out[i], n = out[i + 1];
      c.start = Math.max(c.start, i ? out[i - 1].end : 0);
      if (c.end - c.start < minDur) c.end = c.start + minDur;
      if (n && c.end > n.start) { c.end = Math.max(c.start + 0.05, Math.min(c.end, n.start)); if (c.end < c.start + minDur && n.start < c.start + minDur) n.start = c.end; }
    }
    return out;
  }
  // Agrupa cues consecutivos en oraciones (para traducir con contexto)
  function groupSentences(segs) {
    const out = []; let cur = null;
    for (const s of [...segs].sort((a, b) => a.start - b.start)) {
      if (!s.text.trim()) continue;
      if (!cur || s.start - cur.end > 0.7) { if (cur) out.push(cur); cur = { start: s.start, end: s.end, parts: [] }; }
      cur.parts.push(s); cur.end = s.end;
      if (ENDP.test(s.text.trim()) || cur.parts.length >= 12) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out.map(g => ({ start: g.start, end: g.end, text: g.parts.map(p => p.text.trim()).join(' '), parts: g.parts }));
  }

  return { linePositions, spreadWords, wordsFromSegs, resegment, groupSentences, DEFAULT_STYLE, fmtSrtTime, fmtAssTime, fmtClock, parseClock, toSRT, parseSRT, assColor, wrap, geometry, buildASS, splitLong, guessLang };
});
