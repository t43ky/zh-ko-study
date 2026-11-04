(() => { // 데스크톱 앱: 다른 스크립트와 이름이 겹치지 않도록 감쌈
/* 중한 공부 번역기 - 백그라운드
 * - 단어 분절(Intl.Segmenter) + 병음(pinyin-pro) + 한자음 계산
 * - Google 번역 호출(전체 번역 / 단어 사전)
 * - 단축키·우클릭 메뉴 처리, 구글 TTS 재생
 */
'use strict';

const api = globalThis.browser || globalThis.chrome;
const { pinyin } = globalThis.pinyinPro;
const HANJA = globalThis.HANJA_EUM || {};

const ZH_RE = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2ebef}]/u;
const MAX_CHARS = 1500;

/* ---------------- 분석 ---------------- */

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

function charInfo(chars) {
  // chars: 코드포인트 배열 (문맥을 고려하기 위해 전체 문장을 한 번에 넘긴다)
  const text = chars.join('');
  let all = [];
  try {
    all = pinyin(text, { type: 'all' });
  } catch (e) {
    all = [];
  }
  if (all.length !== chars.length) {
    // 길이가 어긋나면 한 글자씩 계산 (문맥 정보는 잃지만 안전)
    all = chars.map((c) => pinyin(c, { type: 'all' })[0] || { origin: c, isZh: false });
  }
  return chars.map((c, i) => {
    const p = all[i] || {};
    const zh = ZH_RE.test(c);
    return {
      c,
      zh,
      py: zh ? p.pinyin || '' : '',
      tone: zh ? (typeof p.num === 'number' ? p.num : 0) : -1,
      poly: zh && Array.isArray(p.polyphonic) && p.polyphonic.length > 1 ? p.polyphonic : null,
      hj: zh ? HANJA[c] || '' : '',
    };
  });
}

// 단어 나누기: 앱에서는 jieba(메인 프로세스)를 쓰고, 실패하면 브라우저 내장 분절기로 대체
async function segmentWords(text) {
  if (typeof globalThis.zhkoSegment === 'function') {
    try {
      const segs = await globalThis.zhkoSegment(text);
      if (Array.isArray(segs) && segs.join('') === text) return segs;
    } catch (e) {
      console.warn('[zhko] jieba 분절 실패, 내장 분절기 사용:', e);
    }
  }
  return [...segmenter.segment(text)].map((s) => s.segment);
}
const WORD_RE = /[\p{L}\p{N}]/u;

// 동사·형용사 뒤에 홀로 오는 得 는 구조조사 de (说得对, 跑得快). 병음 라이브러리가 dé 로 읽는 경우가 많아 보정
const PRONOUNS = new Set(['我', '你', '他', '她', '它', '我们', '你们', '他们', '她们', '咱们', '您', '谁', '大家']);
function fixDe(tokens) {
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t !== '得' || !t.chars[0]) continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (!prev || !prev.zh || PRONOUNS.has(prev.t)) continue; // 我得走了 → děi 등은 그대로
    if (next && /^了/.test(next.t)) continue; // 得了 → dé
    Object.assign(t.chars[0], { py: 'de', tone: 0 });
  }
}

async function analyze(text) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  let truncated = false;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    truncated = true;
  }
  const chars = Array.from(text);
  const info = charInfo(chars);
  const tokens = [];
  let cp = 0; // 코드포인트 인덱스
  for (const seg of await segmentWords(text)) {
    const segChars = Array.from(seg);
    const ci = info.slice(cp, cp + segChars.length);
    cp += segChars.length;
    const isZh = ci.some((x) => x.zh);
    tokens.push({
      t: seg,
      word: WORD_RE.test(seg),
      zh: isZh,
      chars: ci,
    });
  }
  fixDe(tokens);
  return {
    text,
    truncated,
    hasZh: ZH_RE.test(text),
    tokens,
  };
}

/* ---------------- Google 번역 ---------------- */

const memCache = new Map();
const MEM_LIMIT = 3000;

function cacheSet(k, v) {
  memCache.set(k, v);
  if (memCache.size > MEM_LIMIT) memCache.delete(memCache.keys().next().value);
}

async function gtx(q, opts = {}) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'zh-CN',
    tl: opts.tl || 'ko',
    hl: 'ko',
    dj: '1',
    ie: 'UTF-8',
    oe: 'UTF-8',
  });
  for (const dt of opts.dt || ['t']) params.append('dt', dt);
  // 긴 문장은 POST로 보낸다
  const base = 'https://translate.googleapis.com/translate_a/single';
  let res;
  if (q.length > 400) {
    res = await fetch(`${base}?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ q }),
    });
  } else {
    params.set('q', q);
    res = await fetch(`${base}?${params}`);
  }
  if (!res.ok) throw new Error(`번역 서버 응답 오류 (${res.status})`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) throw new Error('번역 서버가 요청을 거부했습니다 (잠시 후 다시 시도하세요)');
  return res.json();
}

// 문장 번역: AI(Claude, 설정에 API 키가 있을 때) → 실패하거나 없으면 Google
async function translate(text, tokens) {
  let aiError = '';
  if (typeof globalThis.zhkoAI === 'function' && Array.isArray(tokens)) {
    const r = await globalThis.zhkoAI(text, tokens).catch((e) => ({ error: e.message }));
    if (r && !r.error) return { translation: r.translation, words: r.words || {}, note: r.note || '', source: 'claude', model: r.model };
    if (r && r.error) aiError = r.error; // null 이면 AI 꺼짐
  }
  const key = 'T:' + text;
  let out = memCache.get(key);
  if (!out) {
    const data = await gtx(text, { dt: ['t', 'rm'] });
    const sentences = data.sentences || [];
    out = { translation: sentences.filter((s) => s.trans != null).map((s) => s.trans).join(''), source: 'google' };
    cacheSet(key, out);
  }
  return aiError ? Object.assign({}, out, { aiError }) : out;
}

// 단어 뜻: 직접 만든 한국어 사전 + CC-CEDICT(영어) + Google 번역을 합친다
// - 한국어 사전에 있으면 그 뜻을 우선 (한 글자를 Google 로 번역하면 对→오른쪽 처럼 틀리는 경우가 많음)
// - 없으면 Google 번역, 그리고 CC-CEDICT 영어 뜻을 참고로 함께 표시
async function googleWord(word) {
  const key = 'G:' + word;
  if (memCache.has(key)) return memCache.get(key);
  const stored = await getSessionCache(key);
  if (stored) {
    cacheSet(key, stored);
    return stored;
  }
  const data = await gtx(word, { dt: ['t'] });
  const out = { trans: (data.sentences || []).filter((s) => s.trans != null).map((s) => s.trans).join('') };
  cacheSet(key, out);
  setSessionCache(key, out);
  return out;
}

async function lookup(word, py = '') {
  const key = 'L2:' + word + '|' + py;
  if (memCache.has(key)) return memCache.get(key);
  const single = Array.from(word).length === 1;
  const local = typeof globalThis.zhkoDict === 'function' ? await globalThis.zhkoDict(word, py).catch(() => null) : null;
  const ko = (local && local.ko) || [];
  const en = (local && local.en) || [];
  const koMain = ko.some((x) => x.matched) ? ko.filter((x) => x.matched) : ko;

  let trans = '';
  let machine = false;
  let gErr = '';
  const dict = [];
  if (koMain.length) {
    trans = koMain[0].senses[0];
    const showPy = ko.length > 1;
    ko.forEach((x, i) => {
      const terms = i === 0 && koMain[0] === x ? x.senses.slice(1) : x.senses;
      if (!terms.length) return;
      dict.push({ pos: x.matched ? (showPy ? x.py : '') : '다른 읽기 ' + x.py, terms });
    });
  } else {
    try {
      trans = (await googleWord(word)).trans;
      machine = single; // 한 글자 기계 번역은 부정확할 수 있음을 표시
    } catch (e) {
      gErr = e.message;
    }
  }
  const defs = en
    .filter((x) => x.matched || en.length === 1 || !en.some((y) => y.matched))
    .slice(0, 2)
    .map((x) => ({ pos: en.length > 1 ? '영어 ' + x.py : '영어', gloss: x.senses.slice(0, 5).join(' / ') }));

  if (!trans && !dict.length && !defs.length) return { word, error: gErr || '뜻을 찾지 못했습니다' };
  const out = { word, trans, machine, dict, defs };
  cacheSet(key, out);
  return out;
}

async function getSessionCache(key) {
  try {
    if (!api.storage.session) return null;
    const r = await api.storage.session.get(key);
    return r[key] || null;
  } catch {
    return null;
  }
}
function setSessionCache(key, val) {
  try {
    api.storage.session && api.storage.session.set({ [key]: val });
  } catch {
    /* 무시 */
  }
}

/* ---------------- 구글 TTS ---------------- */

let audioQueue = [];
let currentAudio = null;
let ttsVolume = 1;

function splitForTts(text) {
  const parts = [];
  let buf = '';
  for (const piece of text.split(/(?<=[。！？!?；;，,、\n])/)) {
    if ((buf + piece).length > 180) {
      if (buf) parts.push(buf);
      buf = piece;
      while (buf.length > 180) {
        parts.push(buf.slice(0, 180));
        buf = buf.slice(180);
      }
    } else buf += piece;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}

function stopTts() {
  audioQueue = [];
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

function playNext(rate) {
  const part = audioQueue.shift();
  if (!part) {
    currentAudio = null;
    return;
  }
  const url =
    'https://translate.google.com/translate_tts?' +
    new URLSearchParams({ ie: 'UTF-8', client: 'tw-ob', tl: 'zh-CN', q: part, ttsspeed: rate < 0.8 ? '0.24' : '1' });
  const a = new Audio(url);
  a.volume = ttsVolume;
  currentAudio = a;
  a.onended = () => playNext(rate);
  a.onerror = () => playNext(rate);
  a.play().catch(() => playNext(rate));
}

function googleTts(text, rate = 1, volume = 1) {
  stopTts();
  ttsVolume = Math.max(0, Math.min(1, Number(volume)));
  if (!Number.isFinite(ttsVolume)) ttsVolume = 1;
  audioQueue = splitForTts(text);
  playNext(rate);
}

/* ---------------- 단축키 / 메뉴 ---------------- */

async function triggerInTab(tab, selectionText) {
  if (!tab || tab.id == null) return;
  const msg = { type: 'zhko-trigger', selectionText: selectionText || '' };
  try {
    await api.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    // 설치 전부터 열려 있던 탭 등: 콘텐츠 스크립트를 주입 후 재시도
    try {
      await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] });
      await api.tabs.sendMessage(tab.id, msg);
    } catch (e2) {
      console.warn('[zhko] 이 페이지에서는 실행할 수 없습니다:', e2);
    }
  }
}

function openApp(hash = '') {
  api.tabs.create({ url: api.runtime.getURL('pages/app.html' + (hash ? '#' + hash : '')) });
}

api.commands.onCommand.addListener(async (command) => {
  if (command === 'open-vocab') return openApp('vocab');
  if (command === 'analyze-selection') {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    triggerInTab(tab);
  }
});

function setupMenus() {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({
      id: 'zhko-analyze',
      title: '중국어 분석하기: "%s"',
      contexts: ['selection'],
    });
    api.contextMenus.create({
      id: 'zhko-vocab',
      title: '중한 보관함 열기',
      contexts: ['action'],
    });
  });
}
api.runtime.onInstalled.addListener(setupMenus);
api.runtime.onStartup && api.runtime.onStartup.addListener(setupMenus);

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'zhko-analyze') {
    if (tab && tab.url && tab.url.startsWith(api.runtime.getURL(''))) {
      api.tabs.sendMessage(tab.id, { type: 'zhko-trigger', selectionText: info.selectionText || '' });
    } else triggerInTab(tab, info.selectionText);
  }
  if (info.menuItemId === 'zhko-vocab') openApp('vocab');
});

/* ---------------- 메시지 ---------------- */

api.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'analyze':
      return Promise.resolve(analyze(msg.text));
    case 'translate':
      return translate(msg.text, msg.tokens).catch((e) => ({ error: e.message }));
    case 'lookup':
      return lookup(msg.text, msg.py || '').catch((e) => ({ error: e.message }));
    case 'charinfo':
      return Promise.resolve(charInfo(Array.from(msg.text || '')));
    case 'tts':
      googleTts(msg.text || '', msg.rate || 1, msg.volume ?? 1);
      return Promise.resolve(true);
    case 'tts-stop':
      stopTts();
      return Promise.resolve(true);
    case 'open-app':
      openApp(msg.hash || '');
      return Promise.resolve(true);
  }
});
})();
