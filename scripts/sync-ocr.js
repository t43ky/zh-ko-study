// tesseract.js 파일을 src/ocr 로 복사 (라이브러리를 업데이트한 뒤 실행)
const fs = require('fs');
const path = require('path');
const nm = path.join(__dirname, '..', 'node_modules');
const out = path.join(__dirname, '..', 'src', 'ocr');
const files = [
  ['tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'],
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz', 'chi_sim.traineddata.gz'],
  ['@tesseract.js-data/chi_tra/4.0.0_best_int/chi_tra.traineddata.gz', 'chi_tra.traineddata.gz'],
];
fs.mkdirSync(out, { recursive: true });
for (const [from, to] of files) fs.copyFileSync(path.join(nm, from), path.join(out, to));
console.log('copied', files.length, 'files to src/ocr');
