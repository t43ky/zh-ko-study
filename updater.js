/* 자동 업데이트 (zip 배포판용)
 * GitHub Releases 의 최신 릴리스를 확인하고, Windows zip 을 내려받아
 * 앱이 종료된 뒤 PowerShell 스크립트로 프로그램 폴더를 교체하고 다시 실행한다.
 */
'use strict';

const { app, net, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const REPO = 't43ky/zh-ko-study';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const ASSET_RE = /win-x64\.zip$/i;

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

function createUpdater({ getConfig, notify, beforeQuit, isTempLocation, broadcast }) {
  let latest = null;
  let state = 'idle'; // idle | checking | downloading | ready | error
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
    if (state === 'downloading') return status();
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
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const out = fs.createWriteStream(file);
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

  // 앱 종료 후 실행되는 교체 스크립트
  function writeScript(dir) {
    const ps1 = path.join(dir, 'apply-update.ps1');
    const script = `param([int]$AppPid, [string]$Zip, [string]$Dest, [string]$Exe, [string]$Log)
$ErrorActionPreference = 'Continue'
function L($m) { Add-Content -Path $Log -Value ("[" + (Get-Date -Format s) + "] " + $m) -Encoding UTF8 }
L "update start"
try { Wait-Process -Id $AppPid -Timeout 60 -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Milliseconds 800
$stage = Join-Path (Split-Path $Zip) 'staging'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
try {
  Expand-Archive -Path $Zip -DestinationPath $stage -Force
} catch { L ("expand failed: " + $_); Start-Process $Exe; exit 1 }
if (-not (Test-Path (Join-Path $stage 'ZhKoStudy.exe'))) { L "bad archive"; Start-Process $Exe; exit 1 }
$ok = $false
for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
  robocopy $stage $Dest /E /R:3 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -lt 8) { $ok = $true } else { L ("robocopy exit " + $LASTEXITCODE); Start-Sleep -Seconds 1 }
}
L ("copied: " + $ok)
Get-ChildItem -Recurse $Dest | Unblock-File -ErrorAction SilentlyContinue
Start-Process $Exe -ArgumentList '--updated'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $Zip -Force -ErrorAction SilentlyContinue
L "update done"
`;
    // BOM 을 붙여야 Windows PowerShell 5 가 한글 경로를 올바르게 읽는다
    fs.writeFileSync(ps1, '\ufeff' + script, 'utf8');
    return ps1;
  }

  async function install() {
    if (!latest || !latest.url) throw new Error('내려받을 파일이 없습니다');
    if (!canSelfUpdate()) {
      shell.openExternal(RELEASES_PAGE);
      return status();
    }
    const dest = path.dirname(process.execPath);
    try {
      fs.accessSync(dest, fs.constants.W_OK);
    } catch {
      throw new Error(`프로그램 폴더에 쓸 수 없습니다: ${dest}\n(Program Files 대신 C:\\ZhKoStudy 같은 폴더에 두세요)`);
    }
    const dir = path.join(app.getPath('userData'), 'update');
    const zip = path.join(dir, `ZhKoStudy-${latest.version}.zip`);
    state = 'downloading';
    progress = 0;
    emit();
    try {
      await download(latest.url, zip, latest.size);
    } catch (e) {
      state = 'error';
      lastError = e.message;
      emit();
      throw e;
    }
    progress = 100;
    state = 'ready';
    emit();
    const ps1 = writeScript(dir);
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1,
        '-AppPid', String(process.pid), '-Zip', zip, '-Dest', dest, '-Exe', process.execPath, '-Log', path.join(dir, 'update.log')],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.unref();
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

module.exports = { createUpdater, cmpVersion };
