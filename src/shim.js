/* 확장프로그램용 코드(content.js, background.js, app.js)를 그대로 쓰기 위한
 * WebExtension API(browser.*) 대체 구현. 데이터는 메인 프로세스의 JSON 파일에 저장된다. */
(() => {
  'use strict';
  const n = window.native;
  const msgListeners = [];
  const changeListeners = [];
  const ev = (arr) => ({
    addListener: (f) => arr.push(f),
    removeListener: (f) => {
      const i = arr.indexOf(f);
      if (i >= 0) arr.splice(i, 1);
    },
  });
  const noopEv = () => ({ addListener() {}, removeListener() {} });
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  function pick(all, keys) {
    if (keys == null) return clone(all);
    const ks = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    const out = {};
    for (const k of ks) {
      if (k in all) out[k] = clone(all[k]);
      else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[k] = keys[k];
    }
    return out;
  }

  const sessionMem = {};
  n.on('store-changed', (ch) => changeListeners.forEach((f) => f(ch, 'local')));

  let shortcutCache = null;
  async function shortcut() {
    if (!shortcutCache) shortcutCache = (await n.invoke('config-get')).config.shortcut;
    return shortcutCache;
  }
  n.on('config-changed', (c) => (shortcutCache = c.shortcut));

  function hashOf(url) {
    const i = String(url).indexOf('#');
    return i >= 0 ? String(url).slice(i + 1) : 'analyze';
  }

  // jieba 단어 분절 (메인 프로세스)
  window.zhkoSegment = (text) => n.invoke('segment', text);

  window.browser = {
    storage: {
      local: {
        get: async (keys) => pick(await n.invoke('store-get'), keys),
        set: (obj) => n.invoke('store-set', clone(obj)),
      },
      session: {
        get: async (keys) => pick(sessionMem, keys),
        set: async (obj) => Object.assign(sessionMem, clone(obj)),
      },
      onChanged: ev(changeListeners),
    },
    runtime: {
      onMessage: ev(msgListeners),
      onInstalled: noopEv(),
      onStartup: noopEv(),
      getURL: (p) => 'app://' + p,
      async sendMessage(msg) {
        for (const f of msgListeners.slice()) {
          const r = f(msg, {});
          if (r !== undefined) return await r;
        }
      },
    },
    tabs: {
      create: ({ url }) => n.invoke('open-main', hashOf(url)),
      query: async () => [],
      sendMessage: async (_id, msg) => browser.runtime.sendMessage(msg),
    },
    commands: {
      onCommand: noopEv(),
      getAll: async () => [{ name: 'analyze-selection', description: '빠른 분석 (선택한 글)', shortcut: await shortcut() }],
      openShortcutSettings: () => n.invoke('open-main', 'settings'),
    },
    contextMenus: { removeAll: (cb) => cb && cb(), create() {}, onClicked: noopEv() },
    scripting: { executeScript: async () => {} },
  };
})();
