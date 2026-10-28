// Worker de IA: Whisper (transcripción) y Opus-MT (traducción) con transformers.js. 100% local.
import { pipeline, env, Tensor } from './vendor/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true; // cache persistente => offline después de la 1ª descarga
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));

export const MODELS = {
  // variantes _timestamped: incluyen cross-attention => timestamps reales por palabra
  tiny: 'onnx-community/whisper-tiny_timestamped', base: 'onnx-community/whisper-base_timestamped',
  small: 'onnx-community/whisper-small_timestamped', turbo: 'onnx-community/whisper-large-v3-turbo_timestamped',
};
const TR = { 'en-es': 'Xenova/opus-mt-en-es', 'es-en': 'Xenova/opus-mt-es-en' };
const cache = new Map();

async function pickDevice(pref) {
  if (pref === 'wasm') return 'wasm';
  try { if (navigator.gpu && await navigator.gpu.requestAdapter()) return 'webgpu'; } catch {}
  return 'wasm';
}

function progressCb(stage) {
  const files = {};
  return (p) => {
    if (p.status === 'progress' || p.status === 'download') {
      files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
      const tot = Object.values(files).reduce((a, f) => a + f.total, 0), ld = Object.values(files).reduce((a, f) => a + f.loaded, 0);
      postMessage({ type: 'progress', stage, file: p.file, loaded: ld, total: tot, pct: tot ? ld / tot : 0 });
    }
  };
}

async function getPipe(task, model, device, dtype, stage) {
  const key = `${task}|${model}|${device}|${JSON.stringify(dtype)}`;
  if (!cache.has(key)) {
    // liberar modelos de Whisper anteriores para no duplicar RAM
    for (const [k, v] of cache) if (k.startsWith(task) && k !== key) { try { await (await v).dispose(); } catch {} cache.delete(k); }
    cache.set(key, pipeline(task, model, { device, dtype, progress_callback: progressCb(stage) }).catch(e => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}

async function transcribe({ audio, lang, model, device: pref }) {
  const device = await pickDevice(pref);
  const dtype = device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' };
  postMessage({ type: 'status', k: 'Cargando modelo Whisper {m} ({d})…', p: { m: model, d: device === 'webgpu' ? 'GPU / WebGPU' : 'CPU / WASM' }, device });
  let asr;
  try { asr = await getPipe('automatic-speech-recognition', MODELS[model] || model, device, dtype, 'modelo'); }
  catch (e) { if (device === 'webgpu') { postMessage({ type: 'status', k: 'WebGPU falló, uso CPU (WASM)…' }); return transcribe({ audio, lang, model, device: 'wasm' }); } throw e; }
  if (!lang || lang === 'auto') {
    postMessage({ type: 'status', k: 'Detectando idioma…', device });
    lang = await detectLang(asr, audio).catch(e => { console.warn('detectLang', e); return 'en'; });
  }
  postMessage({ type: 'status', k: 'Transcribiendo ({lang})…', p: { lang: lang === 'es' ? 'español' : 'inglés' }, device, lang });
  const total = audio.length / 16000; const segments = []; const words = []; const CH = 30 * 16000;
  const STEP = 28 * 16000; let wordMode = true;
  for (let off = 0; off < audio.length; off += STEP) {
    const slice = audio.subarray(off, Math.min(audio.length, off + CH));
    const opts = { chunk_length_s: 30, task: 'transcribe', language: lang === 'es' ? 'spanish' : 'english' };
    const base = off / 16000; const limit = off + STEP < audio.length ? base + STEP / 16000 : Infinity;
    let out = null;
    if (wordMode) {
      try { out = await asr(slice, { ...opts, return_timestamps: 'word' }); }
      catch (e) { console.warn('word timestamps no disponibles', e); wordMode = false; postMessage({ type: 'log', text: 'timestamps por palabra no disponibles: ' + e.message }); }
    }
    if (wordMode && out) {
      for (const c of out.chunks || []) {
        let [s, e] = c.timestamp; if (s == null) continue; if (e == null) e = s + 0.3;
        s += base; e = Math.min(e + base, total);
        if (s >= limit - 0.05 || s >= total - 0.25) continue;
        const t = c.text.trim(); if (!t) continue;
        words.push({ text: t, start: s, end: Math.max(e, s + 0.05) });
      }
    } else {
      out = await asr(slice, { ...opts, return_timestamps: true });
      for (const c of out.chunks || []) {
        let [s, e] = c.timestamp; if (s == null) continue; if (e == null) e = Math.min(s + 5, slice.length / 16000);
        s += base; e = Math.min(e + base, total);
        if (s >= total - 0.25 || s >= limit - 0.05) continue;
        segments.push({ start: s, end: e, text: c.text.trim() });
      }
    }
    postMessage({ type: 'progress', stage: 'transcripción', pct: Math.min(1, (off + STEP) / audio.length) });
  }
  return { segments, words: wordMode ? words : null, device, seconds: total, lang };
}

// Whisper: después de <|startoftranscript|> el modelo predice el token de idioma. Comparamos <|en|> vs <|es|>
// sobre la ventana de 30 s con más energía (evita silencios iniciales).
async function detectLang(asr, audio) {
  const W = 30 * 16000; let best = 0, bestE = -1;
  for (let off = 0; off < Math.max(1, audio.length - W / 2); off += W) {
    let e = 0; const end = Math.min(audio.length, off + W); for (let i = off; i < end; i += 16) e += audio[i] * audio[i];
    if (e > bestE) { bestE = e; best = off; }
  }
  const win = audio.subarray(best, Math.min(audio.length, best + W));
  const { input_features } = await asr.processor(win);
  const gc = asr.model.generation_config || {};
  const id = (t) => gc.lang_to_id?.[t] ?? asr.tokenizer.token_to_id?.(t) ?? asr.tokenizer.model?.tokens_to_ids?.get(t);
  const sot = gc.decoder_start_token_id ?? id('<|startoftranscript|>');
  const out = await asr.model({ input_features, decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(sot)]), [1, 1]) });
  const V = out.logits.dims.at(-1); const L = out.logits.data; const base = L.length - V;
  const en = L[base + id('<|en|>')], es = L[base + id('<|es|>')];
  postMessage({ type: 'log', text: `idioma: en=${en.toFixed(2)} es=${es.toFixed(2)}` });
  return es > en ? 'es' : 'en';
}

async function translate({ texts, from, to }) {
  const pipe = await getPipe('translation', TR[`${from}-${to}`], 'wasm', 'q8', 'traductor');
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i].trim();
    if (!t) { out.push(''); continue; }
    const r = await pipe(t, { max_new_tokens: 256 });
    out.push(r[0].translation_text);
    postMessage({ type: 'progress', stage: 'traducción', pct: (i + 1) / texts.length });
  }
  return out;
}

onmessage = async (ev) => {
  const { id, type, payload } = ev.data;
  try {
    const result = type === 'transcribe' ? await transcribe(payload) : type === 'translate' ? await translate(payload) : null;
    postMessage({ type: 'done', id, result });
  } catch (e) { postMessage({ type: 'error', id, error: String(e && e.stack || e) }); }
};
