// 사전 데이터 만들기
//  - data/ko-chars-*.txt (직접 작성한 한국어 뜻) → src-dict/ko-dict.json
//  - CC-CEDICT (@tykok/cedict-dictionary, CC BY-SA 4.0) → src-dict/cedict.tsv (간체 \t 병음 \t 뜻/뜻/…)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'dict');
fs.mkdirSync(out, { recursive: true });

// 병음 정규화: 소문자, ü/u: → v, 음절 사이 공백 하나
const normPy = (p) => String(p).toLowerCase().replace(/u:/g, 'v').replace(/ü/g, 'v').replace(/\s+/g, ' ').trim();

// 1) 한국어 뜻
const ko = {};
let nKo = 0;
for (const f of fs.readdirSync(path.join(root, 'data')).filter((x) => /^ko-chars-\d+\.txt$/.test(x)).sort()) {
  for (const line of fs.readFileSync(path.join(root, 'data', f), 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [w, py, senses] = line.split('|');
    if (!w || !py || !senses) throw new Error(`${f}: 형식 오류: ${line}`);
    (ko[w] = ko[w] || []).push({ py: normPy(py), s: senses.split(';').map((x) => x.trim()).filter(Boolean) });
    nKo++;
  }
}
fs.writeFileSync(path.join(out, 'ko-dict.json'), JSON.stringify(ko));

// 2) CC-CEDICT (성씨·이체자 안내 같은 항목은 제외)
const SKIP = /^(surname |variant of|old variant|archaic variant|Japanese variant|see also |see [^a-z]|used in )/i;
const ced = require('@tykok/cedict-dictionary/data/cedict.json');
const lines = [];
for (const e of ced) {
  if (!e.simplified) continue;
  const senses = (e.english || [])
    .filter((s) => !SKIP.test(s))
    .map((s) =>
      s.startsWith('CL:')
        ? '양사: ' + s.slice(3).split(',').map((x) => x.replace(/\[.*?\]/g, '').split('|').pop()).join(', ')
        : s.replace(/([^\s|\[]+)\|([^\s\[]+)\[[^\]]*\]/g, '$2').replace(/\[[a-z0-9: ]+\]/gi, '')
    )
    .slice(0, 8)
    .map((s) => s.replace(/[\t\/]/g, ' ').trim());
  if (!senses.length) continue;
  lines.push(`${e.simplified}\t${normPy(e.pinyin)}\t${senses.join('/')}`);
}
fs.writeFileSync(path.join(out, 'cedict.tsv'), lines.join('\n'));
console.log(`ko: ${nKo} 항목 (${Object.keys(ko).length} 단어) · cedict: ${lines.length} 항목`);
