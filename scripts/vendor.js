// Copia transformers.js + runtime ONNX (WASM) al renderer, para que funcione offline.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'src/renderer/vendor');
fs.mkdirSync(out, { recursive: true });
const t = path.join(root, 'node_modules/@huggingface/transformers/dist'), o = path.join(root, 'node_modules/onnxruntime-web/dist');
fs.copyFileSync(path.join(t, 'transformers.min.js'), path.join(out, 'transformers.min.js'));
fs.copyFileSync(path.join(t, 'ort-wasm-simd-threaded.jsep.mjs'), path.join(out, 'ort-wasm-simd-threaded.jsep.mjs'));
for (const f of fs.readdirSync(o).filter(f => /^ort-wasm-simd-threaded\.(asyncify|jsep)?\.?(mjs|wasm)$/.test(f))) fs.copyFileSync(path.join(o, f), path.join(out, f));
console.log('vendor ok:', fs.readdirSync(out).join(', '));
