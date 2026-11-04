/* 사전 조회 (메인 프로세스)
 * - 직접 작성한 한국어 뜻(dict/ko-dict.json): 자주 쓰는 글자·기능어. 읽기(병음)별로 뜻을 나눔
 * - CC-CEDICT(dict/cedict.tsv): 정확한 영어 뜻 (참고용)
 * 문맥상의 읽기(병음)가 주어지면 그 읽기의 뜻을 먼저 보여준다 (예: 行 xíng / háng)
 */
'use strict';

const fs = require('fs');
const path = require('path');

let ko = null;
let ced = null;

function load() {
  if (ko) return;
  ko = JSON.parse(fs.readFileSync(path.join(__dirname, 'dict', 'ko-dict.json'), 'utf8'));
  ced = new Map();
  for (const line of fs.readFileSync(path.join(__dirname, 'dict', 'cedict.tsv'), 'utf8').split('\n')) {
    const [w, py, s] = line.split('\t');
    if (!w || !s) continue;
    let arr = ced.get(w);
    if (!arr) ced.set(w, (arr = []));
    arr.push({ py, s: s.split('/') });
  }
}

// 병음 정규화: 소문자, ü→v, 성조 부호 → 숫자, 경성은 5
const TONE_MARKS = { ā: 'a1', á: 'a2', ǎ: 'a3', à: 'a4', ē: 'e1', é: 'e2', ě: 'e3', è: 'e4', ī: 'i1', í: 'i2', ǐ: 'i3', ì: 'i4',
  ō: 'o1', ó: 'o2', ǒ: 'o3', ò: 'o4', ū: 'u1', ú: 'u2', ǔ: 'u3', ù: 'u4', ǖ: 'v1', ǘ: 'v2', ǚ: 'v3', ǜ: 'v4', ü: 'v0' };
function syllableToNum(s) {
  s = s.toLowerCase().replace(/u:/g, 'v');
  if (/[1-5]$/.test(s)) return s;
  let tone = 5;
  let plain = '';
  for (const ch of s) {
    const m = TONE_MARKS[ch];
    if (m) {
      plain += m[0];
      if (m[1] !== '0') tone = +m[1];
    } else plain += ch;
  }
  return plain + tone;
}
const normPy = (py) => String(py || '').trim().split(/\s+/).filter(Boolean).map(syllableToNum).join(' ');
const toneless = (py) => py.replace(/[1-5]/g, '');

// 숫자 병음 → 성조 부호 (표시용)
function numToMark(py) {
  return py.split(' ').map((syl) => {
    const m = syl.match(/^([a-zv]+)([1-5])$/);
    if (!m) return syl;
    let [, base, t] = m;
    base = base.replace(/v/g, 'ü');
    if (t === '5') return base;
    const marks = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', ü: 'ǖǘǚǜ' };
    let idx = base.search(/[ae]/);
    if (idx < 0) idx = base.indexOf('ou');
    if (idx < 0) {
      // 마지막 모음
      for (let i = base.length - 1; i >= 0; i--) if ('iouü'.includes(base[i])) { idx = i; break; }
    }
    if (idx < 0) return base;
    const v = base[idx];
    return base.slice(0, idx) + marks[v][+t - 1] + base.slice(idx + 1);
  }).join(' ');
}

// 문맥 읽기와 맞는 항목을 앞으로 (정확히 일치 > 성조 무시 일치 > 나머지)
function orderByReading(entries, py) {
  if (!py || !entries.length) return entries;
  const want = normPy(py);
  const score = (e) => (e.py === want ? 2 : toneless(e.py) === toneless(want) ? 1 : 0);
  const best = Math.max(...entries.map(score));
  if (best === 0) return entries;
  return entries.filter((e) => score(e) === best).concat(entries.filter((e) => score(e) !== best));
}

function lookup(word, py) {
  load();
  word = String(word || '');
  const k = orderByReading((ko[word] || []).map((e) => ({ py: e.py, s: e.s, n: e.n, x: e.x })), py);
  const e = orderByReading((ced.get(word) || []).map((x) => ({ py: x.py, s: x.s })), py);
  const want = py ? normPy(py) : '';
  // 성조까지 같은 읽기가 있으면 그것만, 없으면(성조 변화 一·不 등) 성조를 무시하고 비교
  const anyExact = [...k, ...e].some((x) => x.py === want);
  // 관용 표현(x)은 읽기와 상관없이 그 표현의 뜻
  const matches = (x) => !want || !!x.x || x.py === want || (!anyExact && toneless(x.py) === toneless(want));
  return {
    word,
    // matched: 문맥 읽기와 맞는 항목인지 (아니면 다른 읽기의 뜻)
    ko: k.slice(0, 4).map((x) => ({ py: numToMark(x.py), senses: x.s, matched: matches(x), note: x.n || '', expr: !!x.x })),
    en: e.slice(0, 3).map((x) => ({ py: numToMark(x.py), senses: x.s, matched: matches(x) })),
  };
}

// 사전에 있는 단어인지 (단어 나누기 보정용)
function has(word) {
  load();
  return ced.has(word) || !!ko[word];
}

// 관용 표현 목록 (단어 나누기에서 한 덩어리로 묶음)
let exprList = null;
function exprWords() {
  if (!exprList) exprList = JSON.parse(fs.readFileSync(path.join(__dirname, 'dict', 'expr-words.json'), 'utf8'));
  return exprList;
}
const isExpr = (w) => {
  load();
  return !!(ko[w] && ko[w].some((e) => e.x));
};

module.exports = { lookup, has, isExpr, exprWords, normPy, numToMark };
