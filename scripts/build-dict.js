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
// 1-2) 관용 표현 사전 (data/ko-expr-*.txt: 표현|뜻|쓰임). 병음은 pinyin-pro 로 자동 생성
const { pinyin } = require('../src/lib/pinyin-pro.js');
const ZH = /[\u3400-\u9fff\uf900-\ufaff]/;
const autoPy = (w) =>
  pinyin(w, { type: 'all', toneType: 'num' })
    .filter((x) => x.isZh)
    .map((x) => x.pinyin.replace(/ü/g, 'v') + (x.num ? '' : '5'))
    .map((x) => (/[1-5]$/.test(x) ? x : x + '5'))
    .join(' ');
const exprWords = new Set();
let nExpr = 0;
for (const f of fs.readdirSync(path.join(root, 'data')).filter((x) => /^ko-expr-\d+\.txt$/.test(x)).sort()) {
  for (const line of fs.readFileSync(path.join(root, 'data', f), 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [w, senses, note = ''] = line.split('|').map((x) => x.trim());
    if (!w || !senses) throw new Error(`${f}: 형식 오류: ${line}`);
    const s = senses.split(';').map((x) => x.trim()).filter(Boolean);
    const list = (ko[w] = ko[w] || []);
    if (list.length) {
      // 이미 있는 단어면 뜻을 합친다. 한 글자는 읽기별 항목이라 쓰임 설명을 그 뜻 옆에 붙이고,
      // 여러 글자 표현은 항목 전체의 쓰임 설명으로 둔다
      const single = Array.from(w).length === 1;
      s.forEach((x, k) => {
        const v = single && note && k === 0 ? `${x} (${note})` : x;
        if (!list[0].s.includes(x) && !list[0].s.includes(v)) list[0].s.push(v);
      });
      if (!single) {
        if (note && !list[0].n) list[0].n = note;
        list[0].x = 1;
      }
    } else {
      list.push({ py: ZH.test(w) ? autoPy(w) : '', s, ...(note ? { n: note } : {}), x: 1 });
    }
    exprWords.add(w);
    nExpr++;
  }
}
fs.writeFileSync(path.join(out, 'ko-dict.json'), JSON.stringify(ko));
// 단어 나누기에서 한 덩어리로 묶을 표현 목록
fs.writeFileSync(path.join(out, 'expr-words.json'), JSON.stringify([...exprWords]));

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
console.log(`ko: ${nKo} 항목 + 표현 ${nExpr} 개 (${Object.keys(ko).length} 단어) · cedict: ${lines.length} 항목`);
