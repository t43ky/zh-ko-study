/* 보관함 · 테스트 · 직접 분석 · 설정 페이지 */
'use strict';

const api = globalThis.browser || globalThis.chrome;
const { store, speak, esc } = window.ZhKo;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}
const shuffle = (a) => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const fmtDate = (t) => new Date(t).toLocaleDateString('ko-KR', { year: '2-digit', month: 'short', day: 'numeric' });

function level(it) {
  const s = it.stats || {};
  if (!s.correct && !s.wrong) return '<span class="badge k">새 항목</span>';
  if (s.streak >= 3) return '<span class="badge good">익숙함</span>';
  if (s.wrong > s.correct) return '<span class="badge weak">취약</span>';
  return '<span class="badge k">학습 중</span>';
}

/* ================= 탭 ================= */

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  let tab = h.split('=')[0] || 'analyze';
  if (!['vocab', 'quiz', 'analyze', 'settings'].includes(tab)) tab = 'vocab';
  if (window.ZhKo && window.ZhKo.close) window.ZhKo.close();
  $$('nav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  $$('main > section').forEach((s) => (s.hidden = s.id !== 'tab-' + tab));
  if (tab === 'vocab') renderVocab();
  if (tab === 'quiz' && !quiz.active) renderSetup();
  if (tab === 'settings') renderSettings();
  if (tab === 'analyze') {
    const text = h.includes('=') ? h.slice(h.indexOf('=') + 1) : '';
    if (text) {
      $('#src').value = text;
      history.replaceState(null, '', '#analyze');
      setTimeout(runAnalyze, 50);
    }
    $('#src').focus();
  }
}
window.addEventListener('hashchange', route);
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) location.hash = g.dataset.goto;
});

/* ================= 보관함 ================= */

const vocabState = { type: 'all', q: '', sort: 'new' };

$('#filter-type').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  vocabState.type = b.dataset.v;
  $$('#filter-type button').forEach((x) => x.classList.toggle('on', x === b));
  renderVocab();
});
$('#search').addEventListener('input', (e) => {
  vocabState.q = e.target.value.trim().toLowerCase();
  renderVocab();
});
$('#sort').addEventListener('change', (e) => {
  vocabState.sort = e.target.value;
  renderVocab();
});

function matches(it, q) {
  if (!q) return true;
  const plainPy = (it.pinyin || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return [it.text, it.pinyin, plainPy, plainPy.replace(/\s/g, ''), it.meaning, it.translation, it.note]
    .filter(Boolean)
    .some((s) => s.toLowerCase().includes(q));
}

async function renderVocab() {
  const all = await store.items();
  let list = all.filter((it) => (vocabState.type === 'all' || it.type === vocabState.type) && matches(it, vocabState.q));
  if (vocabState.sort === 'old') list.sort((a, b) => a.createdAt - b.createdAt);
  else if (vocabState.sort === 'weak') list.sort((a, b) => (b.stats?.wrong || 0) - (b.stats?.correct || 0) * 0.5 - ((a.stats?.wrong || 0) - (a.stats?.correct || 0) * 0.5));
  else list.sort((a, b) => b.createdAt - a.createdAt);

  const nW = all.filter((x) => x.type === 'word').length;
  const nS = all.length - nW;
  $('#count').textContent = `단어 ${nW}개 · 문장 ${nS}개` + (list.length !== all.length ? ` (표시 ${list.length}개)` : '');

  if (!all.length) {
    $('#list').innerHTML = `<div class="empty">아직 저장한 항목이 없습니다.<br><br>
      아무 프로그램에서 중국어를 드래그하고 단축키(<kbd id="sc-hint">Ctrl+Alt+Z</kbd>)를 누르거나 ‘직접 분석’에 붙여넣은 뒤,<br>
      단어 상세창의 <b>☆ 단어 저장</b> 또는 상단의 <b>☆ 저장</b>을 눌러 보세요.</div>`;
    fillShortcutHint();
    return;
  }
  if (!list.length) {
    $('#list').innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
    return;
  }
  $('#list').innerHTML = list.map(itemHtml).join('');
}

function highlight(ctx, word) {
  const i = ctx.indexOf(word);
  if (i < 0) return esc(ctx);
  return esc(ctx.slice(0, i)) + '<mark>' + esc(word) + '</mark>' + esc(ctx.slice(i + word.length));
}

function itemHtml(it) {
  const s = it.stats || {};
  const acts = `<div class="acts">
      <button class="ghost" data-a="speak" title="발음 듣기">🔊</button>
      <button class="ghost" data-a="analyze" title="분석 창으로 보기">🔍</button>
      <button class="ghost" data-a="del" title="삭제">🗑</button></div>`;
  const meta = `<div class="meta">${level(it)}<span>정답 ${s.correct || 0} · 오답 ${s.wrong || 0}</span><span>${fmtDate(it.createdAt)} 저장</span>
      ${it.source && it.source.url && /^https?:/.test(it.source.url) ? `<a href="${esc(it.source.url)}" target="_blank" rel="noopener" class="muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.source.title || it.source.url)}</a>` : ''}</div>`;
  const note = `<input type="text" class="note" data-a="note" placeholder="메모 추가…" value="${esc(it.note || '')}">`;
  if (it.type === 'word') {
    return `<div class="item" data-id="${esc(it.id)}">
      <div class="main"><span class="w zh">${esc(it.text)}</span><span class="py">${esc(it.pinyin)}</span></div>${acts}
      <div class="mean">${esc(it.meaning || '(뜻 정보 없음)')}</div>
      ${it.context && it.context !== it.text ? `<div class="ctx"><span class="zh">${highlight(it.context, it.text)}</span>${it.contextTranslation ? `<br>${esc(it.contextTranslation)}` : ''}</div>` : ''}
      ${meta}${note}</div>`;
  }
  return `<div class="item" data-id="${esc(it.id)}">
    <div class="main"><span class="s zh">${esc(it.text)}</span></div>${acts}
    <div class="mean">${esc(it.translation || '(번역 없음)')}</div>
    <div class="tokline">${(it.tokens || [])
      .filter((t) => t.zh)
      .map((t) => `<span title="${esc(t.m || '')}"><b class="zh">${esc(t.t)}</b>${esc(t.py)}</span>`)
      .join('')}</div>
    ${meta}${note}</div>`;
}

$('#list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]');
  if (!b || b.dataset.a === 'note') return;
  const id = b.closest('.item').dataset.id;
  const items = await store.items();
  const it = items.find((x) => x.id === id);
  if (!it) return;
  if (b.dataset.a === 'speak') speak(it.text);
  if (b.dataset.a === 'analyze') window.ZhKo.openPanel(it.text, b.getBoundingClientRect());
  if (b.dataset.a === 'del') {
    if (!confirm(`'${it.text.slice(0, 30)}' 항목을 삭제할까요?`)) return;
    await store.setItems(items.filter((x) => x.id !== id));
    renderVocab();
  }
});
$('#list').addEventListener('change', async (e) => {
  if (!e.target.matches('.note')) return;
  const id = e.target.closest('.item').dataset.id;
  const items = await store.items();
  const it = items.find((x) => x.id === id);
  if (!it) return;
  it.note = e.target.value;
  await store.setItems(items);
  toast('메모를 저장했습니다');
});

// 다른 탭에서 저장하면 자동 갱신
api.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.items && !$('#tab-vocab').hidden && !document.activeElement.matches('.note')) renderVocab();
});

$('#export').addEventListener('click', async () => {
  const items = await store.items();
  const blob = new Blob([JSON.stringify({ app: 'zh-ko-study', version: 1, exportedAt: new Date().toISOString(), items }, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `중한보관함-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const incoming = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(incoming)) throw new Error('형식 오류');
    const items = await store.items();
    const key = (x) => x.type + '\u0000' + x.text;
    const have = new Map(items.map((x) => [key(x), x]));
    let added = 0;
    for (const x of incoming) {
      if (!x || !x.text || !['word', 'sentence'].includes(x.type)) continue;
      if (have.has(key(x))) continue;
      items.push(Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), createdAt: Date.now(), note: '', stats: { correct: 0, wrong: 0, streak: 0, last: 0 } }, x));
      have.set(key(x), x);
      added++;
    }
    await store.setItems(items);
    toast(`${added}개 항목을 가져왔습니다`);
    renderVocab();
  } catch (err) {
    alert('가져오기에 실패했습니다: ' + err.message);
  }
});

/* ================= 테스트 ================= */

const TYPES = {
  'w-meaning': { kind: 'word', label: '뜻 고르기', desc: '중국어 단어를 보고 알맞은 뜻 고르기' },
  'w-hanzi': { kind: 'word', label: '단어 고르기', desc: '한국어 뜻을 보고 알맞은 중국어 고르기' },
  'w-pinyin': { kind: 'word', label: '병음 쓰기', desc: '단어를 보고 병음 입력 (xue2xi2 / xuéxí)' },
  'w-listen': { kind: 'word', label: '듣고 고르기', desc: '발음을 듣고 알맞은 단어 고르기' },
  's-order': { kind: 'sentence', label: '문장 배열', desc: '번역을 보고 단어를 순서대로 배열' },
  's-blank': { kind: 'sentence', label: '빈칸 채우기', desc: '문장에서 빠진 단어 고르기' },
  's-self': { kind: 'sentence', label: '문장 해석', desc: '스스로 해석해 보고 정답과 비교해 채점' },
};

const quiz = { active: false, qs: [], i: 0, opts: null };
const quizRoot = () => $('#quiz-root');

async function renderSetup() {
  quiz.active = false;
  const items = await store.items();
  const saved = (await api.storage.local.get('quizPrefs')).quizPrefs || {};
  const prefs = Object.assign({ scope: 'all', types: Object.keys(TYPES).filter((t) => t !== 's-self'), count: 10, hint: false }, saved);
  if (vocabState.type !== 'all' && location.hash === '#quiz') prefs.scope = vocabState.type;
  const nW = items.filter((x) => x.type === 'word').length;
  const nS = items.length - nW;
  const nWeak = items.filter((x) => (x.stats?.wrong || 0) > 0).length;

  if (!items.length) {
    quizRoot().innerHTML = `<div class="empty">테스트할 항목이 없습니다. 먼저 단어나 문장을 보관함에 저장하세요.</div>`;
    return;
  }
  quizRoot().innerHTML = `
    <div class="card setup">
      <h2>테스트 만들기</h2>
      <div class="row"><label class="t">범위</label>
        <div class="seg" id="q-scope">
          <button data-v="all">전체 (${items.length})</button>
          <button data-v="word">단어 (${nW})</button>
          <button data-v="sentence">문장 (${nS})</button>
          <button data-v="weak">틀린 적 있는 것 (${nWeak})</button>
        </div></div>
      <div class="row"><label class="t">문제 유형</label>
        <div class="checks">${Object.entries(TYPES)
          .map(
            ([k, t]) => `<label><input type="checkbox" value="${k}" ${prefs.types.includes(k) ? 'checked' : ''}>
              <span>${t.kind === 'word' ? '단어' : '문장'} · <b>${t.label}</b><small>${t.desc}</small></span></label>`
          )
          .join('')}</div></div>
      <div class="row"><label class="t">문제 수</label>
        <div class="seg" id="q-count">${[5, 10, 20, 30].map((n) => `<button data-v="${n}">${n}문제</button>`).join('')}</div></div>
      <div class="row"><label><input type="checkbox" id="q-hint" ${prefs.hint ? 'checked' : ''}> 단어 문제에 병음 힌트 보여주기</label></div>
      <p class="small muted">많이 틀린 항목과 아직 풀어보지 않은 항목이 더 자주 나옵니다. 보기 고르기는 숫자키 1~4, 다음 문제는 Enter.</p>
      <div class="next"><button class="primary" id="q-start">테스트 시작</button></div>
      <p class="small" id="q-warn" style="color:var(--bad)"></p>
    </div>`;
  const segSel = (id, v) => {
    $$(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
    $(`#${id}`).onclick = (e) => {
      const b = e.target.closest('button');
      if (b) segSel(id, b.dataset.v);
    };
  };
  segSel('q-scope', prefs.scope);
  segSel('q-count', prefs.count);
  $('#q-start').onclick = async () => {
    const p = {
      scope: $('#q-scope .on').dataset.v,
      types: $$('.checks input:checked').map((x) => x.value),
      count: +$('#q-count .on').dataset.v,
      hint: $('#q-hint').checked,
    };
    api.storage.local.set({ quizPrefs: p });
    const qs = buildQuiz(await store.items(), p);
    if (!qs.length) {
      $('#q-warn').textContent = '조건에 맞는 문제를 만들 수 없습니다. 범위나 문제 유형을 바꿔 보세요. (예: 문장 유형은 저장한 문장이 있어야 합니다)';
      return;
    }
    startQuiz(qs, p);
  };
}

function weight(it) {
  const s = it.stats || { correct: 0, wrong: 0, streak: 0, last: 0 };
  let w = 1 + s.wrong * 1.5 - Math.min(s.streak, 5) * 0.25;
  if (!s.correct && !s.wrong) w += 1;
  const days = (Date.now() - (s.last || 0)) / 864e5;
  if (days > 3) w += 0.5;
  return Math.max(0.2, w);
}
function weightedPick(arr, n) {
  const pool = arr.map((x) => ({ x, w: weight(x) }));
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((a, b) => a + b.w, 0);
    let r = Math.random() * total;
    let k = 0;
    while (k < pool.length - 1 && (r -= pool[k].w) > 0) k++;
    out.push(pool.splice(k, 1)[0].x);
  }
  return out;
}

function zhTokens(it) {
  return (it.tokens || []).filter((t) => t.zh);
}

function applicable(it, type, all) {
  const t = TYPES[type];
  if (t.kind !== it.type) return false;
  const others = all.filter((x) => x.type === 'word' && x.text !== it.text && x.meaning && x.meaning !== it.meaning);
  switch (type) {
    case 'w-meaning':
    case 'w-hanzi':
      return !!it.meaning && others.length >= 1;
    case 'w-listen':
      return all.filter((x) => x.type === 'word' && x.text !== it.text).length >= 1;
    case 'w-pinyin':
      return !!(it.chars && it.chars.length) || !!it.pinyin;
    case 's-order':
      return (it.tokens || []).filter((x) => x.t.trim()).length >= 3 && !!it.translation;
    case 's-blank':
      return zhTokens(it).length >= 2;
    case 's-self':
      return !!it.translation;
  }
  return false;
}

function buildQuiz(items, p) {
  let pool = items;
  if (p.scope === 'word' || p.scope === 'sentence') pool = items.filter((x) => x.type === p.scope);
  if (p.scope === 'weak') pool = items.filter((x) => (x.stats?.wrong || 0) > 0);
  const cand = pool.filter((it) => p.types.some((t) => applicable(it, t, items)));
  const picked = weightedPick(cand, p.count);
  return picked.map((it) => {
    const types = p.types.filter((t) => applicable(it, t, items));
    const type = types[Math.floor(Math.random() * types.length)];
    return makeQuestion(it, type, items);
  });
}

function pickDistractors(list, n, keyFn, exclude) {
  const seen = new Set([exclude]);
  const out = [];
  for (const x of shuffle(list)) {
    const k = keyFn(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= n) break;
  }
  return out;
}

function makeQuestion(it, type, all) {
  const words = all.filter((x) => x.type === 'word');
  const q = { it, type, done: false, correct: null };
  if (type === 'w-meaning') {
    const ds = pickDistractors(words.filter((x) => x.text !== it.text), 3, (x) => x.meaning, it.meaning);
    q.options = shuffle([{ label: it.meaning, ok: true }, ...ds.map((x) => ({ label: x.meaning, ok: false, ref: x }))]);
  } else if (type === 'w-hanzi' || type === 'w-listen') {
    const ds = pickDistractors(words.filter((x) => x.text !== it.text && x.meaning !== it.meaning), 3, (x) => x.text, it.text);
    q.options = shuffle([{ label: it.text, ok: true, zh: true }, ...ds.map((x) => ({ label: x.text, ok: false, zh: true, ref: x }))]);
  } else if (type === 's-blank') {
    const toks = it.tokens || [];
    const zhIdx = toks.map((t, i) => (t.zh ? i : -1)).filter((i) => i >= 0);
    // 길이 2 이상 단어를 우선으로
    const prefer = zhIdx.filter((i) => Array.from(toks[i].t).length >= 2);
    const bi = (prefer.length ? prefer : zhIdx)[Math.floor(Math.random() * (prefer.length || zhIdx.length))];
    q.blank = bi;
    const answer = toks[bi].t;
    const poolTok = [
      ...toks.filter((t, i) => t.zh && i !== bi).map((t) => t.t),
      ...words.map((w) => w.text),
      ...all.filter((x) => x.type === 'sentence' && x !== it).flatMap((x) => zhTokens(x).map((t) => t.t)),
    ];
    const ds = pickDistractors(poolTok, 3, (x) => x, answer);
    q.options = shuffle([{ label: answer, ok: true, zh: true }, ...ds.map((x) => ({ label: x, ok: false, zh: true }))]);
  } else if (type === 's-order') {
    let toks = (it.tokens || []).filter((t) => t.t.trim());
    // 마지막 문장부호는 고정
    q.tail = '';
    while (toks.length && !toks[toks.length - 1].zh && /^[\p{P}\s]+$/u.test(toks[toks.length - 1].t)) {
      q.tail = toks[toks.length - 1].t + q.tail;
      toks = toks.slice(0, -1);
    }
    q.pieces = toks.map((t, i) => ({ t: t.t, i }));
    let sh = shuffle(q.pieces);
    for (let k = 0; k < 5 && sh.map((x) => x.t).join('') === toks.map((x) => x.t).join(''); k++) sh = shuffle(q.pieces);
    q.bank = sh;
    q.answer = toks.map((x) => x.t).join('');
    q.built = [];
  }
  return q;
}

function startQuiz(qs, prefs) {
  quiz.active = true;
  quiz.qs = qs;
  quiz.i = 0;
  quiz.prefs = prefs;
  showQuestion();
}

function wordInfoHtml(it) {
  if (it.type === 'word') {
    return `<div><span class="zh" style="font-size:22px">${esc(it.text)}</span> &nbsp;${esc(it.pinyin || '')}
      ${it.hanja ? ` · 한자음 ${esc(it.hanja)}` : ''}</div><div>${esc(it.meaning || '')}</div>
      ${it.context && it.context !== it.text ? `<div class="small muted zh" style="margin-top:4px">${highlight(it.context, it.text)}</div>` : ''}`;
  }
  return `<div class="zh" style="font-size:19px">${esc(it.text)}</div><div class="small muted">${esc(it.pinyin || '')}</div><div>${esc(it.translation || '')}</div>`;
}

function showQuestion() {
  const q = quiz.qs[quiz.i];
  const it = q.it;
  const total = quiz.qs.length;
  const hint = quiz.prefs.hint;
  let body = '';
  switch (q.type) {
    case 'w-meaning':
      body = `<div class="prompt"><div class="big zh">${esc(it.text)}</div>${hint ? `<div class="sub">${esc(it.pinyin)}</div>` : ''}
        <div class="sub"><button class="ghost" data-q="speak">🔊 듣기</button></div></div>${optsHtml(q)}`;
      break;
    case 'w-hanzi':
      body = `<div class="prompt"><div class="ko">${esc(it.meaning)}</div><div class="sub">알맞은 중국어 단어는?</div></div>${optsHtml(q)}`;
      break;
    case 'w-listen':
      body = `<div class="prompt"><button class="primary" data-q="speak" style="font-size:20px;padding:14px 26px">🔊 다시 듣기</button>
        <div class="sub">들리는 단어를 고르세요</div></div>${optsHtml(q)}`;
      setTimeout(() => speak(it.text), 200);
      break;
    case 'w-pinyin':
      body = `<div class="prompt"><div class="big zh">${esc(it.text)}</div><div class="sub">${esc(it.meaning || '')}</div></div>
        <div class="answer-input"><input type="text" id="py-in" placeholder="예: xue2xi2 또는 xuéxí" autocomplete="off" spellcheck="false">
        <button class="primary" data-q="check-py">확인</button></div>
        <p class="small muted" style="text-align:center">성조는 숫자(1~4, 경성은 생략 또는 5)나 성조 부호로 입력. ü는 v로 입력해도 됩니다.</p>`;
      break;
    case 's-blank': {
      const toks = it.tokens || [];
      body = `<div class="prompt"><div class="sent zh">${toks
        .map((t, i) => (i === q.blank ? `<span class="blank">${'　'.repeat(Math.max(1, Array.from(t.t).length))}</span>` : esc(t.t)))
        .join('')}</div><div class="sub">${esc(it.translation || '')}</div></div>${optsHtml(q)}`;
      break;
    }
    case 's-order':
      body = `<div class="prompt"><div class="ko">${esc(it.translation)}</div><div class="sub">단어를 눌러 순서대로 배열하세요 (배열한 단어를 누르면 되돌림)</div></div>
        <div class="order-area zh" id="ord-area"></div>
        <div class="order-bank zh" id="ord-bank"></div>
        <div class="next"><button data-q="ord-reset">초기화</button><button class="primary" data-q="ord-check">확인</button></div>`;
      break;
    case 's-self':
      body = `<div class="prompt"><div class="sent zh">${esc(it.text)}</div>
        <div class="sub"><button class="ghost" data-q="speak">🔊 듣기</button> <button class="ghost" data-q="show-py">병음 보기</button></div>
        <div class="sub" id="self-py" hidden>${esc(it.pinyin || '')}</div></div>
        <p class="small muted" style="text-align:center">머릿속으로(또는 종이에) 해석해 본 뒤 정답을 확인하세요.</p>
        <div class="next" style="justify-content:center"><button class="primary" data-q="reveal">정답 보기</button></div>
        <div id="self-ans"></div>`;
      break;
  }
  quizRoot().innerHTML = `<div class="card">
    <div class="progress"><div style="width:${(quiz.i / total) * 100}%"></div></div>
    <div class="qtop"><span><span class="qtype">${TYPES[q.type].label}</span></span><span>${quiz.i + 1} / ${total}</span></div>
    ${body}
    <div id="fb"></div></div>`;
  if (q.type === 's-order') renderOrder(q);
  if (q.type === 'w-pinyin') $('#py-in').focus();
}

function optsHtml(q) {
  return `<div class="opts">${q.options
    .map((o, k) => `<button class="opt ${o.zh ? 'zhopt zh' : ''}" data-opt="${k}"><span class="n">${k + 1}</span><span>${esc(o.label)}</span></button>`)
    .join('')}</div>`;
}

function renderOrder(q) {
  $('#ord-area').innerHTML = q.built.length
    ? q.built.map((p, k) => `<button class="chip" data-built="${k}">${esc(p.t)}</button>`).join('') + (q.tail ? `<span style="font-size:22px">${esc(q.tail)}</span>` : '')
    : '<span class="muted small" style="font-family:system-ui">여기에 단어가 쌓입니다</span>';
  const used = new Set(q.built.map((p) => p.i));
  $('#ord-bank').innerHTML = q.bank.map((p) => `<button class="chip ${used.has(p.i) ? 'used' : ''}" data-bank="${p.i}">${esc(p.t)}</button>`).join('');
}

// 병음 채점
const stripTone = (s) => s.normalize('NFD').replace(/[\u0300\u0301\u0304\u030c]/g, '').normalize('NFC');
function expectedPinyin(it) {
  const chars = it.chars && it.chars.length ? it.chars : null;
  if (chars) {
    return {
      mark: chars.map((c) => c.py).join('').toLowerCase().normalize('NFC'),
      num: chars.map((c) => stripTone(c.py) + (c.tone >= 1 && c.tone <= 4 ? c.tone : '')).join('').toLowerCase(),
      plain: chars.map((c) => stripTone(c.py)).join('').toLowerCase(),
    };
  }
  const p = (it.pinyin || '').replace(/\s+/g, '').toLowerCase().normalize('NFC');
  return { mark: p, num: null, plain: stripTone(p) };
}
function checkPinyin(input, it) {
  const exp = expectedPinyin(it);
  let u = input.toLowerCase().replace(/[\s'’·-]+/g, '').replace(/u:/g, 'ü').replace(/v/g, 'ü').normalize('NFC');
  if (!u) return null;
  if (/\d/.test(u)) {
    const n = u.replace(/[05]/g, '');
    if (exp.num && n === exp.num) return 'ok';
    if (n.replace(/\d/g, '') === exp.plain) return 'tone';
    return 'no';
  }
  if (u === exp.mark) return 'ok';
  if (stripTone(u) === exp.plain) return 'tone';
  return 'no';
}

async function answer(ok, extraHtml = '') {
  const q = quiz.qs[quiz.i];
  if (q.done) return;
  q.done = true;
  q.correct = ok;
  // 통계 저장
  const items = await store.items();
  const it = items.find((x) => x.id === q.it.id);
  if (it) {
    it.stats = it.stats || { correct: 0, wrong: 0, streak: 0, last: 0 };
    if (ok) {
      it.stats.correct++;
      it.stats.streak++;
    } else {
      it.stats.wrong++;
      it.stats.streak = 0;
    }
    it.stats.last = Date.now();
    await store.setItems(items);
  }
  $('#fb').innerHTML = `<div class="feedback ${ok ? 'ok' : 'no'}"><div class="head">${ok ? '정답입니다!' : '틀렸습니다'}</div>
    ${extraHtml}${wordInfoHtml(q.it)}</div>
    <div class="next"><button data-q="speak">🔊 듣기</button><button class="primary" data-q="next">${quiz.i + 1 < quiz.qs.length ? '다음 문제 →' : '결과 보기'}</button></div>`;
  $('[data-q="next"]').focus();
}

document.addEventListener('keydown', (e) => {
  if ($('#tab-quiz').hidden || !quiz.active) return;
  const q = quiz.qs[quiz.i];
  if (!q) return;
  if (e.target.matches('input') && e.key === 'Enter' && q.type === 'w-pinyin' && !q.done) {
    e.preventDefault();
    return $('[data-q="check-py"]').click();
  }
  if (e.target.matches('input')) return;
  if (/^[1-4]$/.test(e.key) && q.options && !q.done) {
    const b = $(`[data-opt="${+e.key - 1}"]`);
    if (b) b.click();
  }
  if (e.key === 'Enter' && q.done && e.target === document.body) {
    $('[data-q="next"]') && $('[data-q="next"]').click();
  }
});

document.addEventListener('click', async (e) => {
  if ($('#tab-quiz').hidden) return;
  const q = quiz.qs[quiz.i];
  const opt = e.target.closest('[data-opt]');
  if (opt && q && !q.done) {
    const o = q.options[+opt.dataset.opt];
    $$('[data-opt]').forEach((b) => {
      const oo = q.options[+b.dataset.opt];
      if (oo.ok) b.classList.add('right');
      b.disabled = true;
    });
    if (!o.ok) opt.classList.add('wrong');
    let extra = '';
    if (!o.ok && o.ref) extra = `<div class="small muted" style="margin-bottom:6px">고른 보기: <span class="zh">${esc(o.ref.text)}</span> ${esc(o.ref.pinyin || '')} — ${esc(o.ref.meaning || '')}</div>`;
    if (q.type === 's-blank') {
      // 정답 칸 채우기
      const bl = $('.blank');
      if (bl) bl.textContent = q.options.find((x) => x.ok).label;
    }
    return answer(o.ok, extra);
  }
  const b = e.target.closest('[data-q], [data-bank], [data-built], [data-restart]');
  if (!b) return;
  if (b.dataset.restart) return restart(b.dataset.restart);
  if (b.dataset.bank != null && !q.done) {
    const p = q.pieces.find((x) => x.i === +b.dataset.bank);
    if (!q.built.includes(p)) q.built.push(p);
    return renderOrder(q);
  }
  if (b.dataset.built != null && !q.done) {
    q.built.splice(+b.dataset.built, 1);
    return renderOrder(q);
  }
  switch (b.dataset.q) {
    case 'speak':
      return speak(q.it.text);
    case 'show-py':
      $('#self-py').hidden = false;
      return;
    case 'check-py': {
      if (q.done) return;
      const v = $('#py-in').value;
      const r = checkPinyin(v, q.it);
      if (r == null) return $('#py-in').focus();
      $('#py-in').disabled = true;
      return answer(r === 'ok', r === 'tone' ? '<div style="margin-bottom:6px">발음은 맞았지만 <b>성조</b>가 틀렸습니다.</div>' : `<div class="small muted" style="margin-bottom:6px">입력: ${esc(v)}</div>`);
    }
    case 'ord-reset':
      q.built = [];
      return renderOrder(q);
    case 'ord-check': {
      if (q.done) return;
      if (q.built.length < q.pieces.length) return toast('모든 단어를 배열하세요');
      const mine = q.built.map((p) => p.t).join('');
      $$('#ord-area .chip, #ord-bank .chip').forEach((c) => (c.disabled = true));
      return answer(mine === q.answer, mine === q.answer ? '' : `<div class="small" style="margin-bottom:6px">내 답: <span class="zh">${esc(mine + q.tail)}</span></div>`);
    }
    case 'reveal':
      b.parentElement.remove();
      $('#self-ans').innerHTML = `<div class="feedback" style="background:var(--soft)">${wordInfoHtml(q.it)}
        <div class="tokline" style="margin-top:8px">${zhTokens(q.it).map((t) => `<span title="${esc(t.m)}"><b class="zh">${esc(t.t)}</b>${esc(t.py)}${t.m ? `<i style="font-style:normal">${esc(t.m)}</i>` : ''}</span>`).join('')}</div></div>
        <div class="next" style="justify-content:center"><button data-q="self-no">❌ 틀렸어요</button><button class="primary" data-q="self-ok">⭕ 맞았어요</button></div>`;
      return;
    case 'self-ok':
    case 'self-no':
      $('#self-ans').innerHTML = '';
      return answer(b.dataset.q === 'self-ok');
    case 'next':
      quiz.i++;
      if (quiz.i < quiz.qs.length) showQuestion();
      else showResult();
      return;
  }
});

function showResult() {
  const qs = quiz.qs;
  const ok = qs.filter((q) => q.correct).length;
  const pct = Math.round((ok / qs.length) * 100);
  const msg = pct === 100 ? '완벽해요! 🎉' : pct >= 80 ? '아주 잘했어요!' : pct >= 50 ? '조금만 더 복습해요' : '틀린 것 위주로 다시 풀어 봐요';
  quizRoot().innerHTML = `<div class="card" style="text-align:center">
    <div class="muted">테스트 결과</div>
    <div class="result-score">${ok} / ${qs.length}</div>
    <div>${msg}</div>
    <div class="rlist" style="text-align:left">${qs
      .map((q) => `<div><span class="${q.correct ? 'o' : 'x'}">${q.correct ? 'O' : 'X'}</span>
        <span class="zh" style="font-size:18px">${esc(q.it.text)}</span>
        <span class="muted small">${esc(q.it.type === 'word' ? `${q.it.pinyin} · ${q.it.meaning}` : q.it.translation)}</span>
        <span class="small" style="margin-left:auto;color:var(--muted);white-space:nowrap">${TYPES[q.type].label}</span></div>`)
      .join('')}</div>
    <div class="next" style="justify-content:center;margin-top:20px">
      ${ok < qs.length ? '<button data-restart="wrong">틀린 문제 다시 풀기</button>' : ''}
      <button data-restart="same">같은 문제 다시</button>
      <button class="primary" data-restart="new">새 테스트</button></div></div>`;
  quiz.active = false;
}

async function restart(mode) {
  if (mode === 'new') return renderSetup();
  const items = await store.items();
  const src = mode === 'wrong' ? quiz.qs.filter((q) => !q.correct) : quiz.qs;
  const qs = src
    .map((q) => items.find((x) => x.id === q.it.id) && makeQuestion(items.find((x) => x.id === q.it.id), q.type, items))
    .filter(Boolean);
  startQuiz(shuffle(qs), quiz.prefs);
}

/* ================= 직접 분석 ================= */

function runAnalyze() {
  const t = $('#src').value.trim();
  if (!t) return;
  window.ZhKo.openPanel(t, $('#src').getBoundingClientRect());
}
$('#run').addEventListener('click', runAnalyze);
$('#src').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runAnalyze();
});

/* ================= 설정 ================= */

async function renderSettings() {
  const s = await store.settings();
  $$('[data-k]').forEach((el) => {
    const k = el.dataset.k;
    if (el.type === 'checkbox') el.checked = !!s[k];
    else el.value = s[k];
  });
  $('#rate-v').textContent = '×' + Number(s.speechRate).toFixed(2);
  $('#vol-v').textContent = Math.round(s.volume * 100) + '%';
  const cmds = await api.commands.getAll();
  $('#shortcuts').innerHTML = cmds
    .map((c) => `<div style="padding:4px 0">${esc(c.description || c.name)} — <kbd>${esc(c.shortcut || '(지정 안 됨)')}</kbd></div>`)
    .join('');
}
$$('[data-k]').forEach((el) =>
  el.addEventListener(el.type === 'range' ? 'input' : 'change', async () => {
    const k = el.dataset.k;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
    await store.saveSettings({ [k]: v });
    if (k === 'speechRate') $('#rate-v').textContent = '×' + Number(v).toFixed(2);
    if (k === 'volume') $('#vol-v').textContent = Math.round(v * 100) + '%';
  })
);
$('#tts-test').addEventListener('click', () => speak('你好，很高兴认识你。'));
$('#open-shortcuts') && $('#open-shortcuts').addEventListener('click', () => {
  if (api.commands.openShortcutSettings) api.commands.openShortcutSettings();
  else alert('주소창에 about:addons 를 입력한 뒤, 톱니바퀴(⚙) 메뉴에서 "확장 기능 단축키 관리"를 선택하세요.');
});
$('#wipe').addEventListener('click', async () => {
  const n = (await store.items()).length;
  if (!n) return toast('보관함이 비어 있습니다');
  if (!confirm(`보관함의 ${n}개 항목을 모두 삭제할까요? 되돌릴 수 없습니다.`)) return;
  await store.setItems([]);
  toast('삭제했습니다');
});

async function fillShortcutHint() {
  const el = $('#sc-hint');
  if (!el) return;
  const c = (await api.commands.getAll()).find((x) => x.name === 'analyze-selection');
  if (c && c.shortcut) el.textContent = c.shortcut;
}

route();
