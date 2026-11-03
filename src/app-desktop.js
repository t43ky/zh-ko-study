/* 데스크톱 앱 전용 설정 (전역 단축키, 자동 복사, 클립보드 감시, 자동 실행) */
'use strict';
(() => {
  const n = window.native;
  const $ = (s) => document.querySelector(s);

  function fill({ config, loginSupported }) {
    $('#ap-shortcut').value = config.shortcut;
    $('#ap-autocopy').checked = !!config.autoCopy;
    $('#ap-watch').checked = !!config.watchClipboard;
    $('#ap-login').checked = !!config.openAtLogin;
    if (loginSupported === false) $('#ap-login-row').hidden = true;
    document.querySelectorAll('.sc-key, #sc-hint').forEach((el) => (el.textContent = config.shortcut));
  }
  const load = async () => fill(await n.invoke('config-get'));
  n.on('config-changed', (config) => fill({ config }));

  // 키를 눌러서 단축키 입력
  $('#ap-shortcut').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') return;
    e.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Super');
    let k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
    if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
    if (k === ' ') k = 'Space';
    parts.push(k);
    e.target.value = parts.join('+');
  });

  $('#ap-shortcut-save').addEventListener('click', async () => {
    const v = $('#ap-shortcut').value.trim();
    const r = await n.invoke('config-set', { shortcut: v });
    if (r.ok) alert(`단축키를 ${r.config.shortcut} 로 바꿨습니다.`);
    else alert(`'${v}' 단축키를 등록할 수 없습니다. 다른 프로그램이 쓰고 있거나 지원하지 않는 조합입니다.`);
    fill(r);
  });
  $('#ap-autocopy').addEventListener('change', (e) => n.invoke('config-set', { autoCopy: e.target.checked }));
  $('#ap-watch').addEventListener('change', (e) => n.invoke('config-set', { watchClipboard: e.target.checked }));
  $('#ap-login').addEventListener('change', (e) => n.invoke('config-set', { openAtLogin: e.target.checked }));

  load();
  window.addEventListener('hashchange', load);
})();

/* 설치 (zip 버전 바로가기) */
(() => {
  const n = window.native;
  const $ = (s) => document.querySelector(s);
  function show(st) {
    if (!st || !st.supported) return;
    $('#install-sec').hidden = false;
    $('#inst-path').textContent = st.exe.replace(/[\\/][^\\/]+$/, '');
    let msg;
    if (st.inTemp) msg = '⚠ zip 파일 안에서 바로 실행 중입니다. 먼저 압축을 풀고(예: C:\\ZhKoStudy) 그 안의 ZhKoStudy.exe 를 실행하세요.';
    else if (st.desktop && st.startMenu) msg = '✔ 설치됨 — 바탕화면과 시작 메뉴에 바로가기가 있습니다.';
    else if (st.desktop || st.startMenu) msg = `일부만 설치됨 — ${st.desktop ? '바탕화면' : '시작 메뉴'}에만 바로가기가 있습니다.`;
    else msg = '바로가기가 없습니다. 아래 버튼으로 만들 수 있습니다.';
    $('#inst-status').textContent = msg;
    $('#inst-create').disabled = st.inTemp;
    $('#inst-create').textContent = st.desktop || st.startMenu ? '바로가기 다시 만들기' : '바탕화면·시작 메뉴 바로가기 만들기';
    $('#inst-remove').disabled = !(st.desktop || st.startMenu);
  }
  const load = async () => show(await n.invoke('shortcuts-get'));
  $('#inst-create').addEventListener('click', async () => {
    const st = await n.invoke('shortcuts-set', true);
    show(st);
    alert(st.error ? '바로가기를 만들지 못했습니다.' : '바탕화면과 시작 메뉴에 바로가기를 만들었습니다.');
  });
  $('#inst-remove').addEventListener('click', async () => {
    if (!confirm('바탕화면과 시작 메뉴의 바로가기를 삭제할까요? (보관함 데이터는 그대로입니다)')) return;
    show(await n.invoke('shortcuts-set', false));
  });
  load();
  window.addEventListener('hashchange', load);
})();

/* 업데이트 */
(() => {
  const n = window.native;
  const $ = (s) => document.querySelector(s);
  const esc = window.ZhKo.esc;
  function show(st) {
    if (!st) return;
    let msg = `현재 버전 <b>${esc(st.current)}</b>`;
    if (st.state === 'checking') msg += ' · 확인 중…';
    else if (st.state === 'downloading') msg += ` · 새 버전 ${esc(st.latest)} 내려받는 중… ${st.progress}%`;
    else if (st.state === 'ready') msg += ' · 설치를 위해 다시 시작합니다…';
    else if (st.state === 'error') msg += ` · <span style="color:var(--bad)">확인 실패: ${esc(st.error)}</span>`;
    else if (st.hasUpdate) msg += ` · <b style="color:var(--accent)">새 버전 ${esc(st.latest)} 있음</b>`;
    else if (st.latest) msg += ' · 최신 버전입니다';
    $('#up-status').innerHTML = msg;
    $('#up-install').hidden = !(st.hasUpdate && st.state !== 'downloading' && st.state !== 'ready');
    $('#up-install').textContent = st.canSelfUpdate ? `${st.latest} (으)로 업데이트` : '다운로드 페이지 열기';
    $('#up-check').disabled = st.state === 'checking' || st.state === 'downloading';
  }
  n.on('update-status', show);
  $('#up-check').addEventListener('click', async () => show(await n.invoke('update-check')));
  $('#up-install').addEventListener('click', async () => {
    const r = await n.invoke('update-install');
    if (r && r.error) alert('업데이트 실패: ' + r.error);
  });
  $('#ap-autoupdate').addEventListener('change', (e) => n.invoke('config-set', { autoUpdate: e.target.checked }));
  async function load() {
    const { config } = await n.invoke('config-get');
    $('#ap-autoupdate').checked = config.autoUpdate !== false;
    show(await n.invoke('update-status'));
  }
  load();
  window.addEventListener('hashchange', load);
})();
