/* 자동 업데이트 (zip 배포판용)
 * 1) GitHub Releases 의 최신 릴리스 확인
 * 2) Windows zip 을 내려받아 사용자 폴더(update/staging)에 압축 해제
 * 3) 압축 해제한 "새 버전 프로그램"을 --apply-update 모드로 실행하고 현재 앱 종료
 * 4) 새 버전이 기존 앱 종료를 기다렸다가 자기 파일을 프로그램 폴더에 덮어쓰고, 프로그램 폴더의 앱을 다시 실행
 * (PowerShell 스크립트를 쓰지 않아 백신에 막히지 않도록 함)
 */
'use strict';

const { app, net, dialog, shell, Notification } = require('electron');
const path = require('path');
const ofs = require('original-fs'); // .asar 파일을 일반 파일로 다루기 위해 (Electron 의 asar 처리 우회)
const { spawn } = require('child_process');
const yauzl = require('yauzl');

const REPO = 't43ky/zh-ko-study';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const ASSET_RE = /win-x64\.zip$/i;

const updateDir = () => path.join(app.getPath('userData'), 'update');
const stagingDir = () => path.join(updateDir(), 'staging');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  try {
    ofs.mkdirSync(updateDir(), { recursive: true });
    ofs.appendFileSync(path.join(updateDir(), 'update.log'), `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function fetchLatest() {
  const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ZhKoStudy-Updater' },
    cache: 'no-store',
  });
  if (res.status === 404) return null; // 아직 릴리스 없음
  if (!res.ok) throw new Error(`업데이트 서버 응답 오류 (${res.status})`);
  const r = await res.json();
  const asset = (r.assets || []).find((a) => ASSET_RE.test(a.name));
  return {
    version: String(r.tag_name || '').replace(/^v/i, ''),
    notes: (r.body || '').trim(),
    url: asset ? asset.browser_download_url : null,
    size: asset ? asset.size : 0,
  };
}

/* zip 압축 해제 (스트리밍, 경로 탈출 방지) */
function extractZip(zipFile, outDir, onProgress) {
  const root = path.resolve(outDir) + path.sep;
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true }, (err, zf) => {
      if (err) return reject(err);
      let done = 0;
      const fail = (e) => {
        zf.close();
        reject(e);
      };
      zf.on('error', fail);
      zf.on('end', resolve);
      zf.on('entry', (entry) => {
        const target = path.resolve(outDir, entry.fileName);
        if (!target.startsWith(root)) return zf.readEntry();
        if (/\/$/.test(entry.fileName)) {
          ofs.mkdirSync(target, { recursive: true });
          return zf.readEntry();
        }
        ofs.mkdirSync(path.dirname(target), { recursive: true });
        zf.openReadStream(entry, (e, rs) => {
          if (e) return fail(e);
          const ws = ofs.createWriteStream(target);
          ws.on('error', fail);
          rs.on('error', fail);
          ws.on('close', () => {
            done++;
            if (onProgress) onProgress(done, zf.entryCount);
            zf.readEntry();
          });
          rs.pipe(ws);
        });
      });
      zf.readEntry();
    });
  });
}

/* ---------- 새 버전 쪽: --apply-update 모드 ---------- */

function argOf(argv, k) {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : null;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

async function runApplyHelper(argv = process.argv) {
  const target = argOf(argv, '--target');
  const pid = parseInt(argOf(argv, '--wait-pid'), 10);
  const exeName = argOf(argv, '--exe') || path.basename(process.execPath);
  const src = path.dirname(process.execPath);
  log(`apply: ${src} -> ${target} (wait pid ${pid})`);
  let ok = false;
  try {
    if (!target || path.resolve(target) === path.resolve(src)) throw new Error('잘못된 대상 폴더');
    // 기존 앱이 완전히 끝날 때까지 대기 (최대 60초)
    for (let i = 0; pid && isAlive(pid) && i < 300; i++) await sleep(200);
    await sleep(800);
    let lastErr = null;
    for (let i = 0; i < 30 && !ok; i++) {
      try {
        ofs.cpSync(src, target, { recursive: true, force: true });
        ok = true;
      } catch (e) {
        lastErr = e;
        log(`copy retry ${i + 1}: ${e.code || ''} ${e.message}`);
        await sleep(1000); // 백신 검사 등으로 파일이 잠긴 경우 재시도
      }
    }
    if (!ok) throw lastErr || new Error('복사 실패');
    log('apply: copied');
  } catch (e) {
    log(`apply failed: ${e && e.stack ? e.stack : e}`);
  }
  try {
    const exe = path.join(target || src, exeName);
    spawn(exe, [ok ? '--updated' : '--update-failed'], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) }).unref();
    log(`relaunch: ${exe}`);
  } catch (e) {
    log(`relaunch failed: ${e.message}`);
  }
  setTimeout(() => app.exit(0), 300);
}

/* 업데이트 후 첫 실행: 임시 파일 정리, 결과 알림 */
function afterUpdateStartup({ notify }) {
  const argv = process.argv;
  if (argv.includes('--updated')) {
    log(`started updated version ${app.getVersion()}`);
    notify(`버전 ${app.getVersion()}(으)로 업데이트했습니다.`);
  }
  if (argv.includes('--update-failed')) {
    dialog
      .showMessageBox({
        type: 'error',
        title: '업데이트 실패',
        message: '업데이트 파일을 프로그램 폴더에 적용하지 못했습니다.',
        detail: `기록: ${path.join(updateDir(), 'update.log')}\n다운로드 페이지에서 직접 받아 덮어쓸 수 있습니다.`,
        buttons: ['다운로드 페이지 열기', '닫기'],
      })
      .then((r) => r.response === 0 && shell.openExternal(RELEASES_PAGE));
  }
  // 새 버전 실행 파일이 끝난 뒤 임시 폴더 정리
  setTimeout(() => {
    try {
      ofs.rmSync(stagingDir(), { recursive: true, force: true });
    } catch {}
  }, 8000);
}

/* ---------- 기존 버전 쪽: 확인 · 다운로드 · 적용 시작 ---------- */

function createUpdater({ getConfig, notify, beforeQuit, isTempLocation, broadcast }) {
  let latest = null;
  let state = 'idle'; // idle | checking | downloading | extracting | ready | error
  let progress = 0;
  let lastError = '';
  let timer = null;
  let prompting = false;

  const canSelfUpdate = () => process.platform === 'win32' && app.isPackaged && !isTempLocation();

  function status() {
    return {
      current: app.getVersion(),
      latest: latest ? latest.version : null,
      hasUpdate: !!(latest && cmpVersion(latest.version, app.getVersion()) > 0),
      notes: latest ? latest.notes : '',
      state,
      progress,
      error: lastError,
      canSelfUpdate: canSelfUpdate(),
      page: RELEASES_PAGE,
    };
  }
  const emit = () => broadcast('update-status', status());

  async function check() {
    if (state === 'downloading' || state === 'extracting') return status();
    state = 'checking';
    lastError = '';
    emit();
    try {
      latest = await fetchLatest();
      state = 'idle';
    } catch (e) {
      state = 'error';
      lastError = e.message || String(e);
    }
    emit();
    return status();
  }

  async function download(url, file, total) {
    const res = await net.fetch(url, { headers: { 'User-Agent': 'ZhKoStudy-Updater' } });
    if (!res.ok || !res.body) throw new Error(`내려받기 실패 (${res.status})`);
    ofs.mkdirSync(path.dirname(file), { recursive: true });
    const out = ofs.createWriteStream(file);
    const reader = res.body.getReader();
    let got = 0;
    let lastEmit = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        if (total && Date.now() - lastEmit > 300) {
          progress = Math.min(99, Math.round((got / total) * 100));
          lastEmit = Date.now();
          emit();
        }
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (total && got !== total) throw new Error('내려받은 파일 크기가 맞지 않습니다');
  }

  async function install() {
    if (!latest || !latest.url) throw new Error('내려받을 파일이 없습니다');
    if (!canSelfUpdate()) {
      shell.openExternal(RELEASES_PAGE);
      return status();
    }
    const dest = path.dirname(process.execPath);
    const exeName = path.basename(process.execPath);
    try {
      ofs.accessSync(dest, ofs.constants.W_OK);
    } catch {
      throw new Error(`프로그램 폴더에 쓸 수 없습니다: ${dest}\n(Program Files 대신 C:\\ZhKoStudy 같은 폴더에 두세요)`);
    }
    const zip = path.join(updateDir(), `ZhKoStudy-${latest.version}.zip`);
    const staging = stagingDir();
    try {
      log(`download ${latest.version}`);
      state = 'downloading';
      progress = 0;
      emit();
      await download(latest.url, zip, latest.size);

      state = 'extracting';
      progress = 0;
      emit();
      ofs.rmSync(staging, { recursive: true, force: true });
      await extractZip(zip, staging, (d, t) => {
        const p = Math.round((d / t) * 100);
        if (p !== progress) {
          progress = p;
          emit();
        }
      });
      const newExe = path.join(staging, exeName);
      if (!ofs.existsSync(newExe)) throw new Error('업데이트 파일에 실행 파일이 없습니다');
      try {
        ofs.rmSync(zip, { force: true });
      } catch {}

      state = 'ready';
      progress = 100;
      emit();
      log(`launch helper ${newExe}`);
      spawn(newExe, ['--apply-update', '--target', dest, '--wait-pid', String(process.pid), '--exe', exeName], {
        detached: true,
        stdio: 'ignore',
        cwd: staging,
      }).unref();
    } catch (e) {
      state = 'error';
      lastError = e.message || String(e);
      log(`install failed: ${e && e.stack ? e.stack : e}`);
      emit();
      throw e;
    }
    beforeQuit();
    setTimeout(() => app.quit(), 300);
    return status();
  }

  async function promptIfAvailable({ manual = false } = {}) {
    if (prompting) return;
    const st = await check();
    if (st.state === 'error') {
      if (manual) dialog.showErrorBox('업데이트 확인', '업데이트를 확인하지 못했습니다.\n' + st.error);
      return;
    }
    if (!st.hasUpdate) {
      if (manual) dialog.showMessageBox({ type: 'info', title: '업데이트 확인', message: `최신 버전입니다 (${st.current}).`, buttons: ['확인'] });
      return;
    }
    prompting = true;
    try {
      const r = await dialog.showMessageBox({
        type: 'info',
        title: '중한 공부 번역기 업데이트',
        message: `새 버전 ${st.latest} 이(가) 있습니다. (현재 ${st.current})`,
        detail: (st.notes ? st.notes.slice(0, 800) + '\n\n' : '') +
          (st.canSelfUpdate ? '업데이트하면 프로그램이 잠시 닫혔다가 다시 열립니다. 보관함과 설정은 그대로 유지됩니다.' : '다운로드 페이지를 엽니다.'),
        buttons: ['지금 업데이트', '나중에'],
        defaultId: 0,
        cancelId: 1,
      });
      if (r.response === 0) {
        if (Notification.isSupported() && st.canSelfUpdate) notify('업데이트를 내려받는 중입니다… 끝나면 자동으로 다시 실행됩니다.');
        await install().catch((e) => dialog.showErrorBox('업데이트 실패', e.message));
      }
    } finally {
      prompting = false;
    }
  }

  function start() {
    clearInterval(timer);
    if (!getConfig().autoUpdate) return;
    setTimeout(() => promptIfAvailable(), 8000);
    timer = setInterval(() => promptIfAvailable(), 6 * 60 * 60 * 1000);
  }

  return { status, check, install, promptIfAvailable, start };
}

module.exports = { createUpdater, cmpVersion, runApplyHelper, afterUpdateStartup, extractZip };
