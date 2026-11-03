/* 중한 공부 번역기 - 콘텐츠 스크립트
 * 드래그한 중국어를 분석해서 페이지 위에 학습 패널을 띄운다.
 * 확장 내부 페이지(app.html)에서도 같은 파일을 불러와 window.ZhKo 를 사용한다.
 */
(() => {
  'use strict';
  if (window.__zhkoLoaded) return;
  window.__zhkoLoaded = true;

  const api = globalThis.browser || globalThis.chrome;
  const ZH_RE = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2ebef}]/u;

  /* ================= 저장소 ================= */

  const DEFAULT_SETTINGS = {
    showPinyin: true,
    volume: 1, // 0 ~ 1
    pinyinStyle: 'mark', // mark | num
    autoSpeak: false,
    ttsEngine: 'auto', // auto | browser | google
    speechRate: 0.85,
  };

  const store = {
    async settings() {
      const r = await api.storage.local.get('settings');
      return Object.assign({}, DEFAULT_SETTINGS, r.settings || {});
    },
    async saveSettings(patch) {
      const s = Object.assign(await store.settings(), patch);
      await api.storage.local.set({ settings: s });
      return s;
    },
    async items() {
      const r = await api.storage.local.get('items');
      return Array.isArray(r.items) ? r.items : [];
    },
    async setItems(items) {
      await api.storage.local.set({ items });
    },
    async find(type, text) {
      return (await store.items()).find((x) => x.type === type && x.text === text) || null;
    },
    async add(item) {
      const items = await store.items();
      const i = items.findIndex((x) => x.type === item.type && x.text === item.text);
      const now = Date.now();
      if (i >= 0) {
        items[i] = Object.assign({}, items[i], item, { id: items[i].id, createdAt: items[i].createdAt, stats: items[i].stats, note: items[i].note });
      } else {
        items.unshift(
          Object.assign(
            { id: now.toString(36) + Math.random().toString(36).slice(2, 7), createdAt: now, note: '', stats: { correct: 0, wrong: 0, streak: 0, last: 0 } },
            item
          )
        );
      }
      await store.setItems(items);
      return i >= 0 ? 'updated' : 'added';
    },
    async remove(type, text) {
      const items = (await store.items()).filter((x) => !(x.type === type && x.text === text));
      await store.setItems(items);
    },
  };

  /* ================= 병음 표기 ================= */

  function pyText(ch, style) {
    if (!ch.zh) return '';
    if (style === 'num') {
      const plain = ch.py.normalize('NFD').replace(/[̀́̄̌]/g, '').normalize('NFC');
      return plain + (ch.tone >= 1 && ch.tone <= 4 ? ch.tone : '');
    }
    return ch.py;
  }
  function tokenPinyin(tok, style = 'mark') {
    return tok.chars.filter((c) => c.zh).map((c) => pyText(c, style)).join(' ');
  }
  function tokenHanja(tok) {
    return tok.chars.filter((c) => c.zh).map((c) => c.hj || '?').join('');
  }

  /* ================= 발음(TTS) ================= */

  let voiceCache = null;
  function getZhVoice() {
    if (!('speechSynthesis' in window)) return Promise.resolve(null);
    if (voiceCache !== null) return Promise.resolve(voiceCache);
    return new Promise((resolve) => {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        const v =
          vs.find((x) => /^zh[-_]CN/i.test(x.lang)) ||
          vs.find((x) => /^zh/i.test(x.lang) && !/HK|yue/i.test(x.lang)) ||
          vs.find((x) => /^zh/i.test(x.lang)) ||
          null;
        return v;
      };
      let v = pick();
      if (v || speechSynthesis.getVoices().length) {
        voiceCache = v;
        return resolve(v);
      }
      const t = setTimeout(() => {
        voiceCache = pick();
        resolve(voiceCache);
      }, 700);
      speechSynthesis.addEventListener(
        'voiceschanged',
        () => {
          clearTimeout(t);
          voiceCache = pick();
          resolve(voiceCache);
        },
        { once: true }
      );
    });
  }

  async function speak(text) {
    if (!text) return;
    const s = await store.settings();
    let engine = s.ttsEngine;
    let voice = null;
    if (engine !== 'google') {
      voice = await getZhVoice();
      if (!voice && engine === 'auto') engine = 'google';
    }
    if (engine === 'google') {
      try {
        speechSynthesis && speechSynthesis.cancel();
      } catch {}
      api.runtime.sendMessage({ type: 'tts', text, rate: s.speechRate, volume: s.volume });
      return;
    }
    api.runtime.sendMessage({ type: 'tts-stop' });
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    if (voice) u.voice = voice;
    u.rate = s.speechRate;
    u.volume = Math.max(0, Math.min(1, s.volume));
    speechSynthesis.speak(u);
  }
  function stopSpeak() {
    try {
      speechSynthesis.cancel();
    } catch {}
    api.runtime.sendMessage({ type: 'tts-stop' });
  }

  /* ================= 유틸 ================= */

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const lookupCache = new Map();
  function lookup(word) {
    if (!lookupCache.has(word)) {
      const p = api.runtime.sendMessage({ type: 'lookup', text: word }).then((r) => {
        if (!r || r.error) lookupCache.delete(word); // 실패 시 다음에 재시도
        return r || { error: '응답 없음' };
      });
      lookupCache.set(word, p);
    }
    return lookupCache.get(word);
  }

  function shortMeaning(lk, max = 3) {
    if (!lk || lk.error) return '';
    if (lk.dict && lk.dict.length) {
      const terms = [];
      for (const d of lk.dict) for (const t of d.terms) if (!terms.includes(t)) terms.push(t);
      const tr = lk.trans && lk.trans !== lk.word ? lk.trans : '';
      const list = tr && !terms.slice(0, max).includes(tr) ? [tr, ...terms] : terms;
      return list.slice(0, max).join(', ');
    }
    return lk.trans && lk.trans !== lk.word ? lk.trans : '';
  }


  /* ================= 선택 영역 ================= */

  function getSelectionInfo() {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && /^(text|search|url|)$/i.test(ae.type || '')))) {
      const { selectionStart: a, selectionEnd: b } = ae;
      if (a != null && b != null && b > a) return { text: ae.value.slice(a, b), rect: ae.getBoundingClientRect() };
    }
    const sel = window.getSelection();
    const text = sel ? sel.toString() : '';
    if (!text.trim()) return null;
    let rect = null;
    try {
      const r = sel.getRangeAt(0);
      const rects = r.getClientRects();
      rect = rects.length ? rects[rects.length - 1] : r.getBoundingClientRect();
      const first = rects.length ? rects[0] : rect;
      rect = { left: first.left, top: first.top, bottom: rect.bottom, right: rect.right };
    } catch {}
    return { text, rect };
  }

  /* ================= 스타일 ================= */

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .wrap {
    --bg: #fffdf9; --fg: #1c1917; --muted: #78716c; --line: #e7e0d6; --soft: #f5efe6;
    --accent: #c2410c; --accent-soft: #ffedd5; --box: #ffffff; --box-hover: #fff7ed;
    --shadow: 0 12px 40px rgba(28,25,23,.18), 0 2px 8px rgba(28,25,23,.08);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
    color: var(--fg);
  }
  @media (prefers-color-scheme: dark) {
    .wrap { --bg: #1f1b18; --fg: #f5f0ea; --muted: #a8a29e; --line: #3a332d; --soft: #2a2420;
      --accent: #fb923c; --accent-soft: #3b2615; --box: #27211d; --box-hover: #33291f;
      --shadow: 0 12px 40px rgba(0,0,0,.5); }
  }
  .zh { font-family: "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Source Han Sans SC", sans-serif; }
  .panel {
    position: absolute; width: min(640px, calc(100vw - 24px)); max-height: 70vh; display: flex; flex-direction: column;
    background: var(--bg); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden;
    pointer-events: auto;
  }
  .head { display: flex; align-items: center; gap: 6px; padding: 8px 10px 8px 14px; border-bottom: 1px solid var(--line);
    background: var(--soft); cursor: move; user-select: none; }
  .brand { font-weight: 700; font-size: 13px; color: var(--accent); margin-right: auto; letter-spacing: .02em; }
  .btn { all: unset; cursor: pointer; font-size: 12.5px; padding: 4px 9px; border-radius: 7px; color: var(--fg);
    border: 1px solid var(--line); background: var(--bg); white-space: nowrap; line-height: 1.4; }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .btn.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
  .btn.icon { padding: 4px 7px; }
  .btn.x { border-color: transparent; background: transparent; font-size: 16px; padding: 0 6px; color: var(--muted); }
  .body { padding: 12px 14px 14px; overflow: auto; }
  .tokens { display: flex; flex-wrap: wrap; gap: 6px 4px; align-items: flex-start; }
  .tok { display: inline-flex; flex-direction: column; align-items: center; padding: 4px 6px 3px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--box); cursor: pointer; min-width: 28px; transition: background .1s, border-color .1s; }
  .tok:hover, .tok.active { background: var(--box-hover); border-color: var(--accent); }
  .tok.saved { box-shadow: inset 0 -2px 0 var(--accent); }
  .tok .hz { font-size: 22px; line-height: 1.25; letter-spacing: .02em; }
  .tok .py { font-size: 12px; line-height: 1.3; color: var(--muted); white-space: nowrap; margin-top: 1px; }
  .plain { font-size: 20px; padding: 6px 1px 0; color: var(--muted); align-self: flex-start; }
  .other { font-size: 15px; padding: 8px 2px 0; }
  .hide-py .py { display: none; }
  .vol { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--muted); cursor: default; }
  .vol input { width: 72px; accent-color: var(--accent); cursor: pointer; }
  .sec { margin-top: 14px; }
  .label { font-size: 11.5px; font-weight: 700; color: var(--muted); letter-spacing: .04em; margin-bottom: 4px; display: flex; gap: 8px; align-items: center; }
  .trans { font-size: 15px; line-height: 1.6; padding: 10px 12px; background: var(--soft); border-radius: 10px; }
  .fullpy { font-size: 13px; color: var(--muted); line-height: 1.6; }
  .hint { font-size: 11.5px; color: var(--muted); margin-top: 12px; }
  .err { color: #dc2626; font-size: 13px; }
  .loading { color: var(--muted); font-size: 13px; }
  .card {
    position: fixed; width: 300px; max-height: 60vh; overflow: auto; background: var(--bg); border: 1px solid var(--line);
    border-radius: 12px; box-shadow: var(--shadow); padding: 12px 14px; pointer-events: auto; z-index: 2;
  }
  .c-head { display: flex; align-items: center; gap: 6px; }
  .c-word { font-size: 28px; font-weight: 600; margin-right: auto; line-height: 1.2; }
  .c-py { font-size: 15px; margin-top: 2px; }
  .c-hj { font-size: 12.5px; color: var(--muted); margin-left: 6px; }
  .c-sec { font-size: 11px; font-weight: 700; color: var(--muted); margin: 12px 0 4px; letter-spacing: .04em; }
  .c-main { font-size: 15px; font-weight: 600; }
  .c-pos { font-size: 13px; margin: 2px 0; }
  .c-pos b { display: inline-block; font-size: 11px; color: var(--accent); background: var(--accent-soft); border-radius: 4px;
    padding: 0 5px; margin-right: 5px; font-weight: 600; }
  .c-char { display: grid; grid-template-columns: 34px 1fr; gap: 2px 8px; padding: 6px 0; border-top: 1px dashed var(--line); }
  .c-char:first-of-type { border-top: 0; }
  .c-char .ch { font-size: 24px; line-height: 1.2; grid-row: span 2; text-align: center; }
  .c-char .meta { font-size: 13px; }
  .c-char .mean { font-size: 12.5px; color: var(--muted); }
  .c-tools { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
  .toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); background: #1c1917; color: #fff;
    font: 13px/1.4 system-ui, sans-serif; padding: 9px 16px; border-radius: 999px; box-shadow: var(--shadow); pointer-events: none; }
  `;

  /* ================= UI 상태 ================= */

  let host = null;
  let root = null;
  let state = null; // { text, tokens, translation, settings, saved:Set, sentenceSaved }
  let cardTimer = null;
  let cardTokIdx = -1;

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('zhko-study-panel');
    host.style.cssText = 'all: initial; position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2147483647;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="wrap"></div>`;
    (document.body || document.documentElement).appendChild(host);
  }
  const wrapEl = () => root.querySelector('.wrap');

  function toast(msg) {
    ensureHost();
    wrapEl().querySelectorAll('.toast').forEach((x) => x.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    wrapEl().appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function closePanel() {
    if (!host) return;
    hideCard(true);
    const p = root.querySelector('.panel');
    if (p) p.remove();
    state = null;
    stopSpeak();
  }

  /* ================= 패널 ================= */

  async function show(text, rect) {
    text = String(text || '').trim();
    if (!text) return toast('먼저 중국어 문장을 드래그하세요');
    if (!ZH_RE.test(text)) return toast('선택한 글에 중국어(한자)가 없습니다');
    ensureHost();
    closePanel();

    const settings = await store.settings();
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `<div class="head"><span class="brand">中→韓 분석</span></div><div class="body"><div class="loading">분석 중…</div></div>`;
    wrapEl().appendChild(panel);
    placePanel(panel, rect);

    const analysis = await api.runtime.sendMessage({ type: 'analyze', text });
    const items = await store.items();
    state = {
      text: analysis.text,
      truncated: analysis.truncated,
      tokens: analysis.tokens,
      translation: null,
      transError: null,
      settings,
      saved: new Set(items.filter((x) => x.type === 'word').map((x) => x.text)),
      sentenceSaved: items.some((x) => x.type === 'sentence' && x.text === analysis.text),
      source: { url: location.href, title: document.title },
      panel,
    };
    render();
    placePanel(panel, rect);
    if (settings.autoSpeak) speak(state.text);

    // 전체 번역
    const myState = state;
    api.runtime.sendMessage({ type: 'translate', text: state.text }).then((r) => {
      if (state !== myState) return;
      if (!r || r.error) state.transError = (r && r.error) || '번역 실패';
      else state.translation = r.translation;
      renderTranslation();
    });

  }

  function placePanel(panel, rect) {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const w = panel.offsetWidth || 640;
    const h = panel.offsetHeight || 200;
    const r = rect || { left: (vw - w) / 2, top: vh / 3, bottom: vh / 3 };
    let left = Math.max(12, Math.min(r.left, vw - w - 12));
    let top;
    const below = vh - r.bottom;
    if (below >= h + 16 || below >= r.top) top = r.bottom + 10;
    else top = Math.max(8, r.top - h - 10);
    // 화면 기준 → 문서 기준 (host가 문서 좌상단에 absolute 로 붙어 있음)
    const hostRect = host.getBoundingClientRect();
    panel.style.left = left - hostRect.left + 'px';
    panel.style.top = top - hostRect.top + 'px';
  }

  function tokHtml(tok, i) {
    const s = state.settings;
    if (!tok.zh) {
      const cls = tok.word ? 'other' : 'plain';
      return tok.t.trim() ? `<span class="${cls}">${esc(tok.t)}</span>` : '<span style="width:6px"></span>';
    }
    const py = tok.chars
      .filter((c) => c.zh)
      .map((c) => esc(pyText(c, s.pinyinStyle)))
      .join(' ');
    return `<span class="tok${state.saved.has(tok.t) ? ' saved' : ''}" data-i="${i}">
      <span class="hz zh">${esc(tok.t)}</span>
      <span class="py">${py}</span></span>`;
  }

  function render() {
    const s = state.settings;
    const p = state.panel;
    p.innerHTML = `
      <div class="head">
        <span class="brand">中→韓 분석</span>
        <button class="btn icon" data-act="speak" title="전체 듣기">🔊 듣기</button>
        <button class="btn ${s.showPinyin ? 'on' : ''}" data-act="toggle-py" title="병음 보이기/숨기기">병음</button>
        <label class="vol" title="음량">🔉<input type="range" min="0" max="1" step="0.05" data-act="vol" value="${s.volume}"></label>
        <button class="btn ${state.sentenceSaved ? 'on' : ''}" data-act="save-sentence" title="이 문장을 보관함에 저장">${state.sentenceSaved ? '★ 저장됨' : '☆ 저장'}</button>
        <button class="btn icon" data-act="vocab" title="보관함 열기">📚</button>
        <button class="btn x" data-act="close" title="닫기 (Esc)">✕</button>
      </div>
      <div class="body">
        <div class="tokens ${s.showPinyin ? '' : 'hide-py'}">
          ${state.tokens.map(tokHtml).join('')}
        </div>
        ${state.truncated ? '<div class="hint">※ 너무 길어서 앞부분만 분석했습니다.</div>' : ''}
        <div class="sec">
          <div class="label">번역</div>
          <div class="trans"></div>
        </div>
        <div class="hint">단어에 마우스를 올리면 뜻 · 클릭하면 발음 · 단어가 잘못 나뉘었으면 상세창에서 나누기/합치기</div>
      </div>`;
    renderTranslation();
  }

  function renderTranslation() {
    if (!state) return;
    const el = state.panel.querySelector('.trans');
    if (!el) return;
    if (state.transError) el.innerHTML = `<span class="err">${esc(state.transError)}</span>`;
    else if (state.translation == null) el.innerHTML = '<span class="loading">번역 중…</span>';
    else el.textContent = state.translation;
  }

  /* ================= 상세 카드 ================= */

  function hideCard(now) {
    clearTimeout(cardTimer);
    const go = () => {
      const c = root && root.querySelector('.card');
      if (c) c.remove();
      root && root.querySelectorAll('.tok.active').forEach((e) => e.classList.remove('active'));
      cardTokIdx = -1;
    };
    if (now) go();
    else cardTimer = setTimeout(go, 280);
  }

  async function showCard(tokEl) {
    clearTimeout(cardTimer);
    const idx = +tokEl.dataset.i;
    if (idx === cardTokIdx && root.querySelector('.card')) return;
    hideCard(true);
    cardTokIdx = idx;
    tokEl.classList.add('active');
    const tok = state.tokens[idx];
    const s = state.settings;
    const card = document.createElement('div');
    card.className = 'card';
    const zhChars = tok.chars.filter((c) => c.zh);
    card.innerHTML = `
      <div class="c-head">
        <span class="c-word zh">${esc(tok.t)}</span>
        <button class="btn icon" data-act="c-speak" title="발음 듣기">🔊</button>
        <button class="btn ${state.saved.has(tok.t) ? 'on' : ''}" data-act="c-save">${state.saved.has(tok.t) ? '★ 저장됨' : '☆ 단어 저장'}</button>
      </div>
      <div class="c-py">${zhChars.map((c) => esc(pyText(c, s.pinyinStyle))).join(' ')}
        <span class="c-hj">한자음 ${esc(tokenHanja(tok))}</span></div>
      <div class="c-sec">뜻</div>
      <div class="c-meaning"><span class="loading">불러오는 중…</span></div>
      ${zhChars.length > 1 || (zhChars[0] && zhChars[0].poly) ? `<div class="c-sec">글자 풀이</div><div class="c-chars">${zhChars
        .map(
          (c) => `<div class="c-char" data-c="${esc(c.c)}"><span class="ch zh">${esc(c.c)}</span>
            <span class="meta"><span>${esc(pyText(c, s.pinyinStyle))}</span>
            <span class="c-hj">[${esc(c.hj || '?')}]</span>${c.poly ? `<span class="c-hj">다음자: ${esc(c.poly.join(' / '))}</span>` : ''}</span>
            <span class="mean">…</span></div>`
        )
        .join('')}</div>` : ''}
      <div class="c-tools">
        ${Array.from(tok.t).length > 1 ? '<button class="btn" data-act="c-split">글자로 나누기</button>' : ''}
        ${nextZhIdx(idx) >= 0 ? '<button class="btn" data-act="c-merge">다음 단어와 합치기</button>' : ''}
      </div>`;
    card.dataset.i = idx;
    wrapEl().appendChild(card);
    positionCard(card, tokEl);

    const lk = await lookup(tok.t);
    if (!card.isConnected) return;
    card.querySelector('.c-meaning').innerHTML = meaningHtml(lk);
    positionCard(card, tokEl);
    if (zhChars.length > 1 || (zhChars[0] && zhChars[0].poly)) {
      card.querySelectorAll('.c-char').forEach(async (row) => {
        const clk = await lookup(row.dataset.c);
        if (row.isConnected) row.querySelector('.mean').textContent = shortMeaning(clk, 4) || '(뜻 정보 없음)';
      });
    }
  }

  function meaningHtml(lk) {
    if (!lk || lk.error) return `<span class="err">${esc((lk && lk.error) || '뜻을 불러오지 못했습니다')}</span>`;
    let h = lk.trans && lk.trans !== lk.word ? `<div class="c-main">${esc(lk.trans)}</div>` : '';
    for (const d of lk.dict || []) h += `<div class="c-pos">${d.pos ? `<b>${esc(d.pos)}</b>` : ''}${esc(d.terms.join(', '))}</div>`;
    for (const d of lk.defs || []) h += `<div class="c-pos" style="color:var(--muted)">${d.pos ? `<b>${esc(d.pos)}</b>` : ''}${esc(d.gloss)}</div>`;
    return h || '<span class="loading">사전 정보가 없습니다</span>';
  }

  function positionCard(card, tokEl) {
    const r = tokEl.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let left = Math.max(8, Math.min(r.left, vw - cw - 8));
    let top = r.bottom + 6;
    if (top + ch > vh - 8 && r.top - ch - 6 > 8) top = r.top - ch - 6;
    card.style.left = left + 'px';
    card.style.top = Math.max(8, Math.min(top, vh - ch - 8)) + 'px';
  }

  function nextZhIdx(i) {
    for (let j = i + 1; j < state.tokens.length; j++) {
      if (state.tokens[j].zh) return j;
      if (state.tokens[j].t.trim()) return -1; // 문장부호 등을 넘어서 합치지는 않음
    }
    return -1;
  }

  function splitToken(i) {
    const tok = state.tokens[i];
    const parts = tok.chars.map((c) => ({ t: c.c, word: true, zh: c.zh, chars: [c] }));
    state.tokens.splice(i, 1, ...parts);
    hideCard(true);
    render();
  }
  function mergeToken(i) {
    const j = nextZhIdx(i);
    if (j < 0) return;
    const merged = state.tokens.slice(i, j + 1);
    const tok = { t: merged.map((x) => x.t).join(''), word: true, zh: true, chars: merged.flatMap((x) => x.chars) };
    state.tokens.splice(i, j - i + 1, tok);
    hideCard(true);
    render();
  }

  async function saveWord(tok, btn) {
    const word = tok.t;
    if (state.saved.has(word)) {
      await store.remove('word', word);
      state.saved.delete(word);
      toast(`'${word}' 를 보관함에서 뺐습니다`);
    } else {
      const lk = await lookup(word);
      await store.add({
        type: 'word',
        text: word,
        pinyin: tokenPinyin(tok, 'mark'),
        pinyinNum: tokenPinyin(tok, 'num'),
        hanja: tokenHanja(tok),
        meaning: shortMeaning(lk, 3),
        dict: lk && !lk.error ? lk.dict : [],
        chars: tok.chars.filter((c) => c.zh).map((c) => ({ c: c.c, py: c.py, tone: c.tone, hj: c.hj })),
        context: state.text,
        contextTranslation: state.translation || '',
        source: state.source,
      });
      state.saved.add(word);
      toast(`'${word}' 저장했습니다`);
    }
    const on = state.saved.has(word);
    if (btn) {
      btn.classList.toggle('on', on);
      btn.textContent = on ? '★ 저장됨' : '☆ 단어 저장';
    }
    root.querySelectorAll('.tok').forEach((el) => {
      if (state.tokens[+el.dataset.i].t === word) el.classList.toggle('saved', on);
    });
  }

  async function saveSentence(btn) {
    if (state.sentenceSaved) {
      await store.remove('sentence', state.text);
      state.sentenceSaved = false;
      toast('보관함에서 뺐습니다');
    } else {
      if (state.translation == null && !state.transError) {
        const r = await api.runtime.sendMessage({ type: 'translate', text: state.text });
        if (r && !r.error) state.translation = r.translation;
      }
      const words = {};
      for (const t of state.tokens) {
        if (!t.zh || words[t.t]) continue;
        const c = lookupCache.get(t.t);
        if (c) {
          const lk = await c;
          words[t.t] = shortMeaning(lk, 2);
        }
      }
      await store.add({
        type: 'sentence',
        text: state.text,
        pinyin: state.tokens.filter((t) => t.zh).map((t) => tokenPinyin(t).replace(/ /g, '')).join(' '),
        translation: state.translation || '',
        tokens: state.tokens.filter((t) => t.t.trim()).map((t) => ({ t: t.t, zh: t.zh, py: t.zh ? tokenPinyin(t) : '', m: words[t.t] || '' })),
        source: state.source,
      });
      state.sentenceSaved = true;
      toast('저장했습니다');
    }
    btn.classList.toggle('on', state.sentenceSaved);
    btn.textContent = state.sentenceSaved ? '★ 저장됨' : '☆ 저장';
  }

  /* ================= 이벤트 ================= */

  function bindEvents() {
    if (bindEvents.done) return;
    bindEvents.done = true;

    document.addEventListener(
      'mousedown',
      (e) => {
        if (!state || !host) return;
        if (e.composedPath().includes(host)) return;
        closePanel();
      },
      true
    );
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && state) {
          if (root.querySelector('.card')) hideCard(true);
          else closePanel();
        }
      },
      true
    );
  }

  function bindRoot() {
    if (root.__bound) return;
    root.__bound = true;

    root.addEventListener('mouseover', (e) => {
      if (!state) return;
      const tok = e.target.closest('.tok');
      if (tok) return showCard(tok);
      if (e.target.closest('.card')) return clearTimeout(cardTimer);
    });
    root.addEventListener('mouseout', (e) => {
      if (!state) return;
      const from = e.target.closest('.tok, .card');
      const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.tok, .card') : null;
      if (from && !to) hideCard(false);
    });

    root.addEventListener('click', async (e) => {
      if (!state) return;
      const btn = e.target.closest('[data-act]');
      const tokEl = e.target.closest('.tok');
      if (!btn && tokEl) return speak(state.tokens[+tokEl.dataset.i].t);
      if (!btn) return;
      const act = btn.dataset.act;
      const card = btn.closest('.card');
      const tok = card ? state.tokens[+card.dataset.i] : null;
      switch (act) {
        case 'close':
          return closePanel();
        case 'speak':
          return speak(state.text);
        case 'vocab':
          return api.runtime.sendMessage({ type: 'open-app', hash: 'vocab' });
        case 'toggle-py': {
          state.settings = await store.saveSettings({ showPinyin: !state.settings.showPinyin });
          hideCard(true);
          return render();
        }
        case 'save-sentence':
          return saveSentence(btn);
        case 'c-speak':
          return speak(tok.t);
        case 'c-save':
          return saveWord(tok, btn);
        case 'c-split':
          return splitToken(+card.dataset.i);
        case 'c-merge':
          return mergeToken(+card.dataset.i);
      }
    });

    // 음량 조절
    root.addEventListener('input', async (e) => {
      if (!state || !e.target.matches('[data-act="vol"]')) return;
      state.settings = await store.saveSettings({ volume: +e.target.value });
    });

    // 헤더 드래그로 패널 이동
    root.addEventListener('mousedown', (e) => {
      const head = e.target.closest('.head');
      if (!head || e.target.closest('button, input, label') || !state) return;
      e.preventDefault();
      const p = state.panel;
      const sx = e.clientX;
      const sy = e.clientY;
      const ox = parseFloat(p.style.left) || 0;
      const oy = parseFloat(p.style.top) || 0;
      hideCard(true);
      const move = (ev) => {
        p.style.left = ox + ev.clientX - sx + 'px';
        p.style.top = oy + ev.clientY - sy + 'px';
      };
      const up = () => {
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('mouseup', up, true);
      };
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    });
  }

  async function trigger(fallbackText) {
    const info = getSelectionInfo();
    // 이 프레임에 선택된 글이 없으면 (우클릭 메뉴에서 넘어온 글이 있을 때만) 최상위 프레임에서 처리
    if (!info) {
      if (fallbackText && window === window.top) return openPanel(fallbackText, null);
      if (window === window.top && !fallbackText && !document.querySelector('iframe')) toast('먼저 중국어 문장을 드래그하세요');
      return;
    }
    openPanel(info.text, info.rect);
  }

  async function openPanel(text, rect) {
    ensureHost();
    bindEvents();
    bindRoot();
    await show(text, rect);
  }

  api.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'zhko-trigger') trigger(msg.selectionText);
  });

  // 확장 내부 페이지에서 쓰기 위한 공개 API
  window.ZhKo = { store, speak, stopSpeak, lookup, shortMeaning, openPanel, close: closePanel, esc, DEFAULT_SETTINGS };
})();
