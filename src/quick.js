/* 빠른 분석 창: 화면 전체를 덮는 투명 창. 분석 창 바깥을 클릭하면(또는 Esc) 닫힌다. */
'use strict';
(() => {
  const n = window.native;
  let open = false;
  let observer = null;

  function watchClose() {
    const host = document.querySelector('zhko-study-panel');
    if (!host || !host.shadowRoot || observer) return;
    observer = new MutationObserver(() => {
      if (open && !host.shadowRoot.querySelector('.panel')) {
        open = false;
        n.invoke('quick-hide');
      }
    });
    observer.observe(host.shadowRoot, { childList: true, subtree: true });
  }

  async function quickOpenPanel(text, rect) {
    open = false;
    await window.ZhKo.openPanel(text, rect);
    open = true;
    watchClose();
  }
  window.quickOpenPanel = quickOpenPanel;

  // 커서 바로 아래(공간이 없으면 위)에 분석 창 표시
  n.on('quick-show', ({ text, x, y }) => quickOpenPanel(text, { left: x - 20, top: y - 4, bottom: y + 14, right: x }));

  n.on('quick-close', () => {
    open = false;
    window.ZhKo.close();
  });

  // 분석 창 바깥 클릭 → 닫기 (content.js 도 같은 처리를 하지만 확실하게)
  document.addEventListener('mousedown', (e) => {
    const host = document.querySelector('zhko-study-panel');
    if (open && host && !e.composedPath().includes(host)) window.ZhKo.close();
  });

  document.title = '빠른 분석';
})();

/* ---------------- 화면 글자 인식: 영역 선택 → OCR → 확인 → 분석 ---------------- */
(() => {
  'use strict';
  const n = window.native;
  let cap = null; // 선택 화면 요소
  let box = null; // 인식 결과 확인 상자
  let session = 0;
  let lastShot = null;

  function cleanupCapture() {
    if (cap) cap.remove();
    if (box) box.remove();
    document.querySelectorAll('.ocr-busy').forEach((e) => e.remove());
    cap = box = null;
  }
  function cancel() {
    session++;
    cleanupCapture();
    n.invoke('quick-hide');
  }

  n.on('quick-close', () => {
    session++;
    cleanupCapture();
  });
  n.on('quick-show', () => cleanupCapture());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (cap || box)) {
      e.stopPropagation();
      cancel();
    }
  }, true);

  n.on('capture-show', ({ img, lang, cursor }) => {
    window.ZhKo.close();
    cleanupCapture();
    lastShot = { img, lang };
    openSelector(img, lang);
  });

  function openSelector(img, lang) {
    const my = ++session;
    cap = document.createElement('div');
    cap.className = 'cap';
    cap.style.backgroundImage = `url("${img}")`;
    cap.innerHTML = '<div class="cap-dim"></div><div class="cap-sel"></div><div class="cap-hint">글자가 있는 영역을 드래그하세요 · Esc 취소</div>';
    document.body.appendChild(cap);
    const sel = cap.querySelector('.cap-sel');
    const dim = cap.querySelector('.cap-dim');
    let start = null;
    let rect = null;

    cap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return cancel();
      start = { x: e.clientX, y: e.clientY };
      rect = { x: start.x, y: start.y, w: 0, h: 0 };
      dim.style.display = 'none';
      sel.style.display = 'block';
      draw();
    });
    cap.addEventListener('mousemove', (e) => {
      if (!start) return;
      rect = {
        x: Math.min(start.x, e.clientX),
        y: Math.min(start.y, e.clientY),
        w: Math.abs(e.clientX - start.x),
        h: Math.abs(e.clientY - start.y),
      };
      draw();
    });
    cap.addEventListener('mouseup', async () => {
      if (!start) return;
      start = null;
      if (!rect || rect.w < 6 || rect.h < 6) {
        // 너무 작으면 다시 선택
        sel.style.display = 'none';
        dim.style.display = 'block';
        return;
      }
      await runOcr(img, lang, rect, my);
    });

    function draw() {
      Object.assign(sel.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
      // 선택 영역 안은 원래 밝기로 보이게
      sel.style.backgroundImage = `url("${img}")`;
      sel.style.backgroundSize = `${innerWidth}px ${innerHeight}px`;
      sel.style.backgroundPosition = `${-rect.x - 2}px ${-rect.y - 2}px`;
    }
  }

  async function crop(img, rect) {
    const im = new Image();
    im.src = img;
    await im.decode();
    const sx = im.naturalWidth / innerWidth;
    const sy = im.naturalHeight / innerHeight;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(rect.w * sx));
    c.height = Math.max(1, Math.round(rect.h * sy));
    c.getContext('2d').drawImage(im, rect.x * sx, rect.y * sy, rect.w * sx, rect.h * sy, 0, 0, c.width, c.height);
    return c;
  }

  async function runOcr(img, lang, rect, my) {
    const busy = document.createElement('div');
    busy.className = 'ocr-busy';
    busy.textContent = '글자 인식 중…';
    busy.style.left = rect.x + 'px';
    busy.style.top = Math.min(rect.y + rect.h + 8, innerHeight - 40) + 'px';
    document.body.appendChild(busy);
    let text = '';
    let err = '';
    try {
      const canvas = await crop(img, rect);
      text = await window.ZhKoOCR.recognize(canvas, {
        lang,
        onProgress: (m) => {
          if (m.status === 'recognizing text') busy.textContent = `글자 인식 중… ${Math.round(m.progress * 100)}%`;
          else if (/load|initializ/i.test(m.status)) busy.textContent = '인식 엔진 준비 중…';
        },
      });
    } catch (e) {
      err = (e && (e.message || String(e))) || '알 수 없는 오류';
    }
    busy.remove();
    if (my !== session) return;
    if (cap) cap.remove();
    cap = null;
    showResult(text, err, rect);
  }

  function showResult(text, err, rect) {
    box = document.createElement('div');
    box.className = 'ocr-box';
    const found = /[㐀-鿿豈-﫿]/.test(text);
    box.innerHTML = `
      <div class="t">${err ? '인식 실패' : found ? '인식한 글 (틀린 글자는 고친 뒤 분석하세요)' : '중국어를 찾지 못했습니다'}</div>
      <textarea spellcheck="false"></textarea>
      <div class="row"><span>Enter 분석 · Shift+Enter 줄바꿈 · Esc 닫기</span>
        <button data-a="again">다시 선택</button><button data-a="cancel">닫기</button><button class="primary" data-a="go">분석</button></div>`;
    const ta = box.querySelector('textarea');
    ta.value = err ? '' : text;
    if (err) ta.placeholder = err;
    document.body.appendChild(box);
    // 선택 영역 아래(공간이 없으면 위)에 표시
    const bh = box.offsetHeight;
    let top = rect.y + rect.h + 10;
    if (top + bh > innerHeight - 10) top = Math.max(10, rect.y - bh - 10);
    box.style.left = Math.max(10, Math.min(rect.x, innerWidth - box.offsetWidth - 10)) + 'px';
    box.style.top = top + 'px';
    ta.focus();
    ta.select();

    const go = async () => {
      const t = ta.value.trim();
      if (!t) return ta.focus();
      const r = { left: parseFloat(box.style.left), top: parseFloat(box.style.top), bottom: parseFloat(box.style.top) + 4, right: parseFloat(box.style.left) };
      box.remove();
      box = null;
      await window.quickOpenPanel(t, r);
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        go();
      }
    });
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    box.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'go') go();
      if (a.dataset.a === 'cancel') cancel();
      if (a.dataset.a === 'again') {
        box.remove();
        box = null;
        openSelector(lastShot.img, lastShot.lang);
      }
    });
  }

  // 상자 바깥(빈 화면)을 클릭하면 닫기
  document.addEventListener('mousedown', (e) => {
    if (box && !box.contains(e.target)) cancel();
  });
})();
