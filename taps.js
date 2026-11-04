/* 연속 탭 단축키 (예: ⌘ 두 번, Control → Shift)
 * 수정 키(Control/Option(Alt)/Shift/⌘(Win))를 "혼자" 짧게 눌렀다 떼는 것을 탭으로 보고,
 * 두 번의 탭이 짧은 간격으로 이어지면 등록된 동작을 실행한다.
 * 두 번째 키를 뗀 순간에 실행하므로, 그때는 아무 키도 눌려 있지 않다
 * → 자동 복사(⌘C/Ctrl+C)에 다른 수정 키가 섞이지 않는다.
 */
'use strict';

// uiohook 키 코드 → 이름 (왼쪽/오른쪽 구분 없음)
const MOD_KEYS = {
  29: 'Ctrl', 3613: 'Ctrl',
  56: 'Alt', 3640: 'Alt',
  42: 'Shift', 54: 'Shift',
  3675: 'Meta', 3676: 'Meta',
};

const TAP_MAX_MS = 400; // 한 번의 탭: 누른 뒤 이 시간 안에 떼야 함
const GAP_MAX_MS = 450; // 두 탭 사이 간격

// sequences: { 'Meta,Meta': fn, 'Ctrl,Shift': fn2 }
function createTapDetector(getSequences, now = () => Date.now()) {
  const down = new Map(); // keycode → { dirty, t }
  let lastTap = null; // { name, t }

  function keydown(code) {
    if (down.has(code)) return; // 길게 눌러 반복 입력되는 것은 무시
    for (const v of down.values()) v.dirty = true; // 다른 키와 함께 누름 → 탭 아님
    down.set(code, { dirty: down.size > 0, t: now() });
    if (!MOD_KEYS[code]) lastTap = null; // 일반 키를 누르면 연속 탭이 끊김
  }

  function keyup(code) {
    const st = down.get(code);
    down.delete(code);
    const name = MOD_KEYS[code];
    const t = now();
    if (!st || !name || st.dirty || t - st.t > TAP_MAX_MS) {
      lastTap = null;
      return null;
    }
    if (lastTap && t - lastTap.t <= GAP_MAX_MS) {
      const seq = lastTap.name + ',' + name;
      lastTap = null;
      const fn = getSequences()[seq];
      if (fn) {
        fn();
        return seq;
      }
      // 등록되지 않은 조합이면 이번 탭을 새 시작으로
      lastTap = { name, t };
      return null;
    }
    lastTap = { name, t };
    return null;
  }

  function reset() {
    lastTap = null;
  }

  return { keydown, keyup, reset };
}

module.exports = { createTapDetector, MOD_KEYS };
