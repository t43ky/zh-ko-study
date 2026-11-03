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

  n.on('quick-show', async ({ text, x, y }) => {
    open = false;
    // 커서 바로 아래(공간이 없으면 위)에 분석 창 표시
    await window.ZhKo.openPanel(text, { left: x - 20, top: y - 4, bottom: y + 14, right: x });
    open = true;
    watchClose();
  });

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
