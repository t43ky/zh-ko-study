/* 중한 공부 번역기 - 데스크톱 앱 (Electron 메인 프로세스)
 * - 전역 단축키: 다른 프로그램에서 선택한 글을 복사해서 커서 옆 빠른 분석 창에 표시
 * - 클립보드 감시(선택): 중국어를 복사하면 바로 분석
 * - 트레이 상주, 데이터는 사용자 폴더의 JSON 파일에 저장
 */
'use strict';

const {
  app, BrowserWindow, globalShortcut, clipboard, ipcMain, Tray, Menu, nativeImage, screen, shell, session, Notification, dialog, desktopCapturer,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { createUpdater, runApplyHelper, afterUpdateStartup } = require('./updater');
const dictionary = require('./dict');

const ZH_RE = /[㐀-䶿一-鿿豈-﫿]/;
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// 업데이트 적용 모드: 압축 해제된 새 버전이 기존 프로그램 폴더를 덮어쓰고 다시 실행한 뒤 종료
if (process.argv.includes('--apply-update')) {
  runApplyHelper(process.argv);
  return;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

/* ---------------- 저장소 ---------------- */

const userDir = app.getPath('userData');
const DATA_FILE = path.join(userDir, 'data.json');
const CONFIG_FILE = path.join(userDir, 'config.json');

const DEFAULT_CONFIG = {
  shortcut: isMac ? 'Control+Alt+Z' : 'Ctrl+Alt+Z',
  autoCopy: true,
  watchClipboard: false,
  openAtLogin: false,
  shownTrayHint: false,
  askedShortcuts: false,
  autoUpdate: true,
  appleTranslate: true, // 맥: 애플 번역 사용
  ocrShortcut: isMac ? 'Control+Alt+X' : 'Ctrl+Alt+X',
  ocrLang: 'chi_sim', // chi_sim(간체) | chi_tra(번체)
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

let data = readJson(DATA_FILE, {});
let config = Object.assign({}, DEFAULT_CONFIG, readJson(CONFIG_FILE, {}));
const saveConfig = () => writeJson(CONFIG_FILE, config);

/* ---------------- 창 ---------------- */

let mainWin = null;
let quickWin = null;
let tray = null;
let quitting = false;

const iconPath = path.join(__dirname, 'src', 'icon.png');

function webPrefs() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

function guardNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
}

function openMain(hash = 'analyze') {
  if (!mainWin || mainWin.isDestroyed()) {
    mainWin = new BrowserWindow({
      width: 1040,
      height: 820,
      minWidth: 420,
      minHeight: 400,
      title: '중한 공부 번역기',
      icon: iconPath,
      autoHideMenuBar: true,
      show: false,
      webPreferences: webPrefs(),
    });
    guardNavigation(mainWin);
    mainWin.loadFile(path.join(__dirname, 'src', 'app.html'), { hash });
    mainWin.once('ready-to-show', () => mainWin.show());
    mainWin.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      mainWin.hide();
      if (!config.shownTrayHint && Notification.isSupported()) {
        new Notification({
          title: '중한 공부 번역기',
          body: `트레이에서 계속 실행 중입니다. 다른 프로그램에서 중국어를 드래그하고 ${config.shortcut} 를 누르세요.`,
        }).show();
        config.shownTrayHint = true;
        saveConfig();
      }
    });
  } else {
    mainWin.webContents.executeJavaScript(`location.hash = ${JSON.stringify('#' + hash)}`).catch(() => {});
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
  }
  mainWin.focus();
}


function createQuick() {
  quickWin = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    webPreferences: webPrefs(),
  });
  quickWin.setAlwaysOnTop(true, isMac ? 'screen-saver' : 'floating');
  // 맥: 전체 화면 앱·다른 데스크톱 위에서도 빠른 분석 창이 보이도록
  if (isMac) quickWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  guardNavigation(quickWin);
  quickWin.loadFile(path.join(__dirname, 'src', 'quick.html'));
  quickWin.on('blur', () => hideQuick());
}

// 맥: 빠른 분석 창을 띄우기 전에 이 앱이 맨 앞(활성)이었는지 기억해 둔다.
// 다른 앱을 쓰다가 띄웠다면, 닫을 때 앱을 숨겨서 원래 쓰던 앱으로 돌아가게 한다.
// (그냥 창만 숨기면 macOS 가 이 앱의 다음 창인 메인 창을 앞으로 꺼낸다)
let quickPrevActive = true;
function rememberActive() {
  const f = BrowserWindow.getFocusedWindow();
  quickPrevActive = !!f && f !== quickWin;
}

function hideQuick() {
  if (quickWin && !quickWin.isDestroyed() && quickWin.isVisible()) {
    quickWin.webContents.send('quick-close');
    quickWin.hide();
    if (isMac && !quickPrevActive) app.hide();
  }
}

// 빠른 분석 창은 화면 전체를 덮는 투명 창. 분석 창 바깥 아무 곳이나 클릭하면 닫힌다.
function showQuick(text) {
  if (!quickWin || quickWin.isDestroyed()) createQuick();
  if (!quickWin.isVisible()) rememberActive();
  const pt = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  quickWin.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
  const send = () => {
    quickWin.webContents.send('quick-show', { text, x: pt.x - wa.x, y: pt.y - wa.y });
    quickWin.show();
    quickWin.focus();
  };
  if (quickWin.webContents.isLoading()) quickWin.webContents.once('did-finish-load', send);
  else send();
}
const isLinux = () => process.platform === 'linux';

/* ---------------- 애플 번역 (맥 전용) ---------------- */
// native/mac/zhko-translate.swift 로 만든 도우미 프로그램을 띄워 두고 한 줄씩 주고받는다

const native = { proc: null, ready: null, status: null, seq: 0, waiters: new Map() };

function nativeHelperPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'zhko-translate') : path.join(__dirname, 'build', 'mac', 'zhko-translate');
}

function startNative() {
  if (native.proc) return native.ready;
  const bin = nativeHelperPath();
  if (!fs.existsSync(bin)) {
    native.status = { ready: false, code: 'missing', error: '애플 번역 도우미 파일이 없습니다' };
    return (native.ready = Promise.resolve(native.status));
  }
  native.ready = new Promise((resolve) => {
    let buf = '';
    const p = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    native.proc = p;
    const timer = setTimeout(() => resolve((native.status = { ready: false, code: 'timeout', error: '애플 번역 도우미가 응답하지 않습니다' })), 8000);
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if ('ready' in msg) {
          clearTimeout(timer);
          native.status = msg;
          resolve(msg);
        } else if (msg.id != null && native.waiters.has(msg.id)) {
          native.waiters.get(msg.id)(msg);
          native.waiters.delete(msg.id);
        }
      }
    });
    const fail = (err) => {
      clearTimeout(timer);
      native.proc = null;
      native.status = { ready: false, code: 'crashed', error: '애플 번역 도우미 실행 실패' + (err ? ': ' + err.message : '') };
      resolve(native.status);
      for (const f of native.waiters.values()) f({ error: native.status.error, code: 'crashed' });
      native.waiters.clear();
      native.ready = null; // 다음 요청 때 다시 시도
    };
    p.on('error', fail);
    p.on('exit', () => fail());
  });
  return native.ready;
}

// 돌려주는 값: null(맥이 아니거나 꺼짐) | { text } | { error, code }
async function nativeTranslate(text) {
  if (!isMac || !config.appleTranslate) return null;
  const st = await startNative();
  if (!st || !st.ready) return { error: (st && st.error) || '애플 번역을 쓸 수 없습니다', code: st && st.code };
  const id = ++native.seq;
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      native.waiters.delete(id);
      resolve({ error: '애플 번역 시간이 초과되었습니다', code: 'timeout' });
    }, 15000);
    native.waiters.set(id, (m) => {
      clearTimeout(t);
      resolve(m.text != null ? { text: m.text } : { error: m.error || '번역 실패', code: m.code });
    });
    native.proc.stdin.write(JSON.stringify({ id, text: String(text).slice(0, 5000) }) + '\n');
  });
}

/* ---------------- 단어 나누기 (jieba) ---------------- */

let jieba = null;
function getJieba() {
  if (!jieba) {
    jieba = require('jieba-wasm');
    // 관용 표현·인터넷 용어는 한 단어로 묶이도록 사전에 추가 (下班愉快, 吃一堑长一智, 绝绝子 …)
    // 이미 한 단어로 나뉘는 표현은 건드리지 않고, 두 글자 표현은 낮은 우선순위로 넣어
    // 银行吧 → 银|行吧 처럼 기존 단어를 깨뜨리지 않게 한다
    for (const w of dictionary.exprWords()) {
      const n = Array.from(w).length;
      if (n < 2) continue;
      try {
        const cut = jieba.cut(w, true);
        if (cut.length === 1 && cut[0] === w) continue;
        jieba.add_word(w, n === 2 ? 300 : 30000);
      } catch {}
    }
  }
  return jieba;
}

// 5글자 이상 긴 복합어(예: 中华人民共和国国务院)는 공부하기 좋게 4글자 이하 단어로 다시 나눈다
function splitLong(word) {
  const j = getJieba();
  const cands = new Set(j.cut_for_search(word, true).filter((x) => {
    const n = Array.from(x).length;
    return n >= 2 && n <= 4;
  }));
  const chars = Array.from(word);
  const out = [];
  for (let i = 0; i < chars.length; ) {
    let len = Math.min(4, chars.length - i);
    for (; len > 1; len--) if (cands.has(chars.slice(i, i + len).join(''))) break;
    out.push(chars.slice(i, i + len).join(''));
    i += len;
  }
  return out;
}

// 사전에 없는 덩어리(打了个, 说得对 등)는 사전에 있는 단어로 다시 나눈다 (최장 일치, 최대 4글자)
function splitByDict(word) {
  const chars = Array.from(word);
  const out = [];
  for (let i = 0; i < chars.length; ) {
    let len = Math.min(4, chars.length - i);
    for (; len > 1; len--) if (dictionary.has(chars.slice(i, i + len).join(''))) break;
    out.push(chars.slice(i, i + len).join(''));
    i += len;
  }
  return out;
}

function segmentText(text) {
  const out = [];
  for (const w of getJieba().cut(text, true)) {
    const n = Array.from(w).length;
    if (n < 2 || !ZH_RE.test(w)) out.push(w);
    else if (dictionary.isExpr(w)) out.push(w); // 관용 표현은 길어도 그대로
    else if (n >= 5) out.push(...splitLong(w));
    else if (!dictionary.has(w)) out.push(...splitByDict(w));
    else out.push(w);
  }
  return out;
}

/* ---------------- 화면 글자 인식(OCR) ---------------- */

let capturing = false;

async function startCapture({ fromMain = false } = {}) {
  if (capturing) return;
  capturing = true;
  try {
    if (!quickWin || quickWin.isDestroyed() || !quickWin.isVisible()) rememberActive();
    else if (quickWin.isVisible()) {
      quickWin.webContents.send('quick-close');
      quickWin.hide(); // 다시 캡처할 때는 앱을 숨기지 않고 창만 닫는다
    }
    if (fromMain && mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) mainWin.minimize();
    await new Promise((r) => setTimeout(r, fromMain ? 350 : 120)); // 창이 사라질 때까지 대기
    const pt = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(pt);
    const sf = display.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) },
    });
    const src = sources.find((x) => String(x.display_id) === String(display.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) {
      notify(isMac
        ? '화면을 캡처하지 못했습니다. 시스템 설정 → 개인정보 보호 및 보안 → 화면 기록에서 이 앱을 허용해 주세요.'
        : '화면을 캡처하지 못했습니다.');
      return;
    }
    if (!quickWin || quickWin.isDestroyed()) createQuick();
    const b = display.bounds;
    quickWin.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    const payload = { img: src.thumbnail.toDataURL(), lang: config.ocrLang, cursor: { x: pt.x - b.x, y: pt.y - b.y } };
    const send = () => {
      quickWin.webContents.send('capture-show', payload);
      quickWin.show();
      quickWin.focus();
    };
    if (quickWin.webContents.isLoading()) quickWin.webContents.once('did-finish-load', send);
    else send();
  } catch (e) {
    notify('화면 캡처 중 오류가 발생했습니다: ' + (e && e.message));
  } finally {
    capturing = false;
  }
}

/* ---------------- 선택한 글 복사 ---------------- */

let psProc = null;
let psWaiters = [];

function windowsCopier() {
  if (psProc && !psProc.killed && psProc.exitCode == null) return psProc;
  // 수정 키(Alt/Shift/Ctrl)를 뗄 때까지 기다린 뒤 Ctrl+C 를 보낸다
  const script = `
Add-Type -AssemblyName System.Windows.Forms
while ($true) {
  $l = [Console]::In.ReadLine()
  if ($l -eq $null) { break }
  $t = 0
  while ([System.Windows.Forms.Control]::ModifierKeys -ne 'None' -and $t -lt 75) { Start-Sleep -Milliseconds 20; $t++ }
  [System.Windows.Forms.SendKeys]::SendWait('^c')
  [Console]::Out.WriteLine('ok')
}`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  psProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  psProc.stdout.on('data', (d) => {
    const n = String(d).split('ok').length - 1;
    for (let i = 0; i < n; i++) (psWaiters.shift() || (() => {}))();
  });
  psProc.on('exit', () => {
    psProc = null;
    psWaiters.splice(0).forEach((f) => f());
  });
  return psProc;
}

// 맥 자동 복사 스크립트 (JavaScript for Automation)
const MAC_COPY_JXA = `
ObjC.import('Cocoa');
var MODS = (1 << 17) | (1 << 18) | (1 << 19) | (1 << 20); // Shift, Control, Option, Command
var released = false;
for (var i = 0; i < 100; i++) {           // 최대 2초
  if (($.NSEvent.modifierFlags & MODS) === 0) { released = true; break; }
  delay(0.02);
}
var se = Application('System Events');
if (!released) {
  // 2초가 지나도 누르고 있으면 수정 키를 뗀 것으로 처리한 뒤 복사
  try { se.keyUp(59); se.keyUp(58); se.keyUp(56); } catch (e) {} // control, option, shift
}
delay(0.05);
se.keystroke('c', { using: 'command down' });
`;

function simulateCopy() {
  return new Promise((resolve) => {
    const done = () => resolve();
    setTimeout(done, 1800); // 안전장치
    try {
      if (isWin) {
        const p = windowsCopier();
        psWaiters.push(done);
        p.stdin.write('copy\n');
      } else if (isMac) {
        // 손쉬운 사용(접근성) 권한이 필요.
        // 단축키의 Control/Option/Shift/⌘ 를 실제로 뗄 때까지 기다렸다가 ⌘C 를 보낸다.
        // (Option 을 누른 채 ⌘C 가 나가면 사파리에서 Option+⌘+C = 개발자 도구(JavaScript 콘솔)가 열림)
        execFile('osascript', ['-l', 'JavaScript', '-e', MAC_COPY_JXA], done);
      } else {
        execFile('xdotool', ['key', '--clearmodifiers', 'ctrl+c'], done);
      }
    } catch {
      done();
    }
  });
}

let busy = false;
let ignoreClipUntil = 0;

async function quickAnalyze() {
  if (busy) return;
  busy = true;
  try {
    let text = '';
    if (config.autoCopy) {
      const before = (await clipboard.readText());
      const marker = `__zhko_${Date.now()}__`;
      ignoreClipUntil = Date.now() + 3000;
      await clipboard.writeText(marker);
      await simulateCopy();
      // 복사 결과가 클립보드에 들어올 때까지 잠깐 기다림
      for (let i = 0; i < 10 && (await clipboard.readText()) === marker; i++) await new Promise((r) => setTimeout(r, 40));
      const after = (await clipboard.readText());
      if (after === marker || !after.trim()) {
        await clipboard.writeText(before); // 복사 실패 → 원래 클립보드 복원 후 그 내용 사용
        text = before;
      } else text = after;
      lastClip = (await clipboard.readText());
    } else {
      text = (await clipboard.readText());
    }
    text = (text || '').trim();
    if (!ZH_RE.test(text)) {
      notify(config.autoCopy
        ? '선택한 글에서 중국어를 찾지 못했습니다. 글을 드래그한 뒤 다시 시도하거나, Ctrl+C로 복사한 뒤 단축키를 눌러 보세요.'
        : '클립보드에 중국어가 없습니다. 중국어를 복사(Ctrl+C)한 뒤 단축키를 누르세요.');
      return;
    }
    showQuick(text.slice(0, 1500));
  } finally {
    busy = false;
  }
}

function notify(body) {
  if (Notification.isSupported()) new Notification({ title: '중한 공부 번역기', body }).show();
}

/* ---------------- 클립보드 감시 ---------------- */

let lastClip = '';
let clipTimer = null;
function setWatch(on) {
  clearInterval(clipTimer);
  clipTimer = null;
  if (!on) return;
  Promise.resolve(clipboard.readText()).then((t) => (lastClip = t));
  clipTimer = setInterval(async () => {
    const t = (await clipboard.readText());
    if (t === lastClip) return;
    lastClip = t;
    if (Date.now() < ignoreClipUntil) return;
    if (t && ZH_RE.test(t) && t.length <= 1500 && !t.startsWith('__zhko_')) showQuick(t.trim());
  }, 500);
}

/* ---------------- 단축키 / 트레이 ---------------- */

// 전역 단축키 등록. 실패한 항목 이름 목록을 돌려준다
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const failed = [];
  const reg = (key, fn) => {
    const acc = config[key];
    if (!acc) return;
    try {
      if (!globalShortcut.register(acc, fn)) failed.push(key);
    } catch {
      failed.push(key);
    }
  };
  reg('shortcut', quickAnalyze);
  if (config.ocrShortcut !== config.shortcut) reg('ocrShortcut', () => startCapture());
  else failed.push('ocrShortcut');
  return failed;
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `빠른 분석  (${config.shortcut})`, click: quickAnalyze },
      { label: `화면에서 글자 인식  (${config.ocrShortcut})`, click: () => startCapture() },
      { label: '직접 입력해서 분석', click: () => openMain('analyze') },
      { label: '보관함', click: () => openMain('vocab') },
      { label: '테스트', click: () => openMain('quiz') },
      { type: 'separator' },
      {
        label: '클립보드 감시 (중국어 복사 시 바로 분석)',
        type: 'checkbox',
        checked: config.watchClipboard,
        click: (item) => applyConfig({ watchClipboard: item.checked }),
      },
      { label: '설정', click: () => openMain('settings') },
      { label: `업데이트 확인 (현재 ${app.getVersion()})`, click: () => updater.promptIfAvailable({ manual: true }) },
      { type: 'separator' },
      { label: '종료', click: () => { quitting = true; app.quit(); } },
    ])
  );
  tray.setToolTip(`중한 공부 번역기 — ${config.shortcut}`);
}

function applyConfig(patch) {
  const prev = { shortcut: config.shortcut, ocrShortcut: config.ocrShortcut };
  config = Object.assign({}, config, patch);
  let ok = true;
  if ('shortcut' in patch || 'ocrShortcut' in patch) {
    const failed = registerShortcuts().filter((k) => k in patch);
    if (failed.length) {
      ok = false;
      for (const k of failed) config[k] = prev[k];
      registerShortcuts();
    }
  }
  if ('watchClipboard' in patch) setWatch(config.watchClipboard);
  if ('autoUpdate' in patch) updater.start();
  if ('openAtLogin' in patch && !isLinux()) app.setLoginItemSettings({ openAtLogin: !!config.openAtLogin, args: ['--hidden'] });
  saveConfig();
  buildTrayMenu();
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('config-changed', config));
  return { ok, config };
}

/* ---------------- 설치 (zip 버전용 바로가기) ---------------- */

const APP_NAME = '중한 공부 번역기';

function shortcutPaths() {
  return {
    desktop: path.join(app.getPath('desktop'), APP_NAME + '.lnk'),
    startMenu: path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', APP_NAME + '.lnk'),
  };
}

function shortcutStatus() {
  if (!isWin) return { supported: false };
  const p = shortcutPaths();
  return {
    supported: true,
    packaged: app.isPackaged,
    exe: process.execPath,
    inTemp: isTempLocation(),
    desktop: fs.existsSync(p.desktop),
    startMenu: fs.existsSync(p.startMenu),
  };
}

// zip 파일을 풀지 않고 안에서 바로 실행한 경우 (임시 폴더에서 실행됨)
function isTempLocation() {
  const exe = process.execPath.toLowerCase();
  const tmp = app.getPath('temp').toLowerCase();
  return exe.startsWith(tmp) || /\\temp\\|\\temporary internet files\\/.test(exe);
}

function createShortcuts() {
  if (!isWin) return shortcutStatus();
  if (isTempLocation()) return Object.assign(shortcutStatus(), { error: 'temp' });
  const ico = path.join(process.resourcesPath, 'icon.ico');
  const opts = {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    description: '중국어 문장을 단어별로 분석하는 공부용 번역기',
    icon: fs.existsSync(ico) ? ico : process.execPath,
    iconIndex: 0,
    appUserModelId: 'local.zhko.study',
  };
  const p = shortcutPaths();
  let ok = true;
  for (const file of [p.desktop, p.startMenu]) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      ok = shell.writeShortcutLink(file, fs.existsSync(file) ? 'replace' : 'create', opts) && ok;
    } catch {
      ok = false;
    }
  }
  // 자동 실행이 켜져 있으면 새 위치로 다시 등록
  if (config.openAtLogin) app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
  return Object.assign(shortcutStatus(), ok ? {} : { error: 'write' });
}

function removeShortcuts() {
  if (!isWin) return shortcutStatus();
  for (const file of Object.values(shortcutPaths())) {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
  return shortcutStatus();
}

async function firstRunInstall() {
  if (!isWin || !app.isPackaged || config.askedShortcuts) return;
  const st = shortcutStatus();
  if (st.desktop || st.startMenu) return;
  if (st.inTemp) {
    await dialog.showMessageBox({
      type: 'warning',
      title: APP_NAME,
      message: 'zip 파일 안에서 바로 실행 중입니다.',
      detail: 'zip 파일을 먼저 압축 해제한 뒤(예: C:\\ZhKoStudy 폴더), 그 안의 ZhKoStudy.exe 를 실행해 주세요.\n지금 상태로는 프로그램을 닫으면 파일이 사라져 바로가기를 만들 수 없습니다.',
      buttons: ['확인'],
    });
    return;
  }
  const r = await dialog.showMessageBox({
    type: 'question',
    title: APP_NAME,
    message: '바탕화면과 시작 메뉴에 바로가기를 만들까요?',
    detail: `프로그램 위치: ${path.dirname(process.execPath)}\n\n바로가기를 만든 뒤에는 이 폴더를 옮기거나 지우지 마세요. 나중에 설정 → 설치에서 다시 만들거나 지울 수 있습니다.`,
    buttons: ['만들기', '나중에'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: '컴퓨터를 켤 때 자동 실행',
    checkboxChecked: false,
  });
  config.askedShortcuts = true;
  saveConfig();
  if (r.response === 0) {
    const res = createShortcuts();
    if (r.checkboxChecked) applyConfig({ openAtLogin: true });
    if (res.error) dialog.showErrorBox(APP_NAME, '바로가기를 만들지 못했습니다. 설정 → 설치에서 다시 시도해 주세요.');
    else notify('바탕화면과 시작 메뉴에 바로가기를 만들었습니다.');
  }
}

/* ---------------- 자동 업데이트 ---------------- */

const updater = createUpdater({
  getConfig: () => config,
  notify: (m) => notify(m),
  beforeQuit: () => (quitting = true),
  isTempLocation: () => isTempLocation(),
  broadcast: (ch, p) => broadcast(ch, p),
});

/* ---------------- IPC ---------------- */

function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((w) => !w.isDestroyed() && w.webContents.send(channel, payload));
}

ipcMain.handle('store-get', () => data);
ipcMain.handle('store-set', (_e, obj) => {
  const changes = {};
  for (const [k, v] of Object.entries(obj || {})) {
    changes[k] = { oldValue: data[k], newValue: v };
    data[k] = v;
  }
  writeJson(DATA_FILE, data);
  broadcast('store-changed', changes);
  return true;
});
ipcMain.handle('open-main', (_e, hash) => openMain(hash || 'analyze'));
ipcMain.handle('config-get', () => ({ config, platform: process.platform, loginSupported: !isLinux() }));
ipcMain.handle('config-set', (_e, patch) => applyConfig(patch || {}));
ipcMain.handle('quick-hide', () => hideQuick());
ipcMain.handle('native-translate', (_e, text) => nativeTranslate(String(text || '')));
ipcMain.handle('native-status', async () => {
  if (!isMac) return { supported: false };
  if (!config.appleTranslate) return { supported: true, enabled: false };
  const st = await startNative();
  return Object.assign({ supported: true, enabled: true }, st);
});
ipcMain.handle('segment', (_e, text) => segmentText(String(text || '')));
ipcMain.handle('dict', (_e, word, py) => dictionary.lookup(word, py));
// 한자가 없는 토큰(yyds, 666, emo …)이 인터넷 용어인지 (두 자리 이하 숫자는 가격 등과 헷갈려 제외)
ipcMain.handle('expr-check', (_e, list) =>
  (Array.isArray(list) ? list : []).map((w) => !/^\d{1,2}$/.test(String(w)) && dictionary.isExpr(String(w)))
);
ipcMain.handle('start-capture', () => startCapture({ fromMain: true }));
ipcMain.handle('shortcuts-get', () => shortcutStatus());
ipcMain.handle('update-status', () => updater.status());
ipcMain.handle('update-check', () => updater.check());
ipcMain.handle('update-install', () => updater.install().catch((e) => ({ error: e.message })));
ipcMain.handle('shortcuts-set', (_e, on) => (on ? createShortcuts() : removeShortcuts()));

/* ---------------- 시작 ---------------- */

app.on('second-instance', () => openMain());
app.on('before-quit', () => (quitting = true));
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (psProc) psProc.kill();
  if (native.proc) native.proc.kill();
});
app.on('window-all-closed', (e) => e.preventDefault?.());

global.__zhkoQuick = () => quickAnalyze(); // 테스트·디버그용
global.__zhkoCapture = () => startCapture(); // 테스트·디버그용

app.whenReady().then(() => {
  if (isWin) app.setAppUserModelId('local.zhko.study');
  // 맥: 응용 프로그램 폴더 밖(다운로드 폴더 등)에서 실행하면 옮길지 묻는다 (자동 업데이트를 위해 필요)
  if (isMac && app.isPackaged && !app.isInApplicationsFolder() && !config.askedMoveToApps) {
    config.askedMoveToApps = true;
    saveConfig();
    const r = dialog.showMessageBoxSync({
      type: 'question',
      message: '응용 프로그램 폴더로 옮길까요?',
      detail: '응용 프로그램 폴더에 있어야 자동 업데이트가 됩니다.',
      buttons: ['옮기기', '나중에'],
      defaultId: 0,
      cancelId: 1,
    });
    if (r === 0) {
      try {
        if (app.moveToApplicationsFolder()) return; // 옮긴 뒤 자동으로 다시 실행됨
      } catch (e) {
        dialog.showErrorBox('옮기지 못했습니다', e.message);
      }
    }
  }
  // 번역 서버 응답에 CORS 허용 헤더 추가 (앱 화면은 file:// 에서 열리므로)
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['https://translate.googleapis.com/*', 'https://translate.google.com/*'] },
    (details, cb) => {
      const h = {};
      for (const [k, v] of Object.entries(details.responseHeaders || {})) if (!/^access-control-allow-/i.test(k)) h[k] = v;
      h['Access-Control-Allow-Origin'] = ['*'];
      cb({ responseHeaders: h });
    }
  );

  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  // 맥은 메뉴 막대 아이콘을 누르면 메뉴만 보여야 한다 (click 까지 처리하면 메인 창이 같이 열림)
  if (!isMac) tray.on('click', () => openMain());
  buildTrayMenu();

  const failedKeys = registerShortcuts();
  if (failedKeys.length) {
    notify(`단축키 ${failedKeys.map((k) => config[k]).join(', ')} 를 등록하지 못했습니다. 다른 프로그램이 사용 중일 수 있습니다. 설정에서 바꿔 주세요.`);
  }
  setWatch(config.watchClipboard);
  createQuick();
  if (isWin) windowsCopier(); // 미리 띄워 두면 첫 단축키가 빨라짐

  const hidden = process.argv.includes('--hidden');
  if (!hidden) openMain('analyze');
  setTimeout(firstRunInstall, 800);
  afterUpdateStartup({ notify });
  updater.start();
  setTimeout(() => { try { segmentText('预热'); } catch {} }, 1500); // 사전 미리 불러오기
  if (isMac && config.appleTranslate) setTimeout(() => startNative(), 2000); // 애플 번역 도우미 미리 실행
  app.on('activate', () => openMain());
});
