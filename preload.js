// 화면(렌더러)에 최소한의 통신 기능만 노출
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_INVOKE = ['store-get', 'store-set', 'open-main', 'config-get', 'config-set', 'quick-hide', 'shortcuts-get', 'shortcuts-set', 'update-status', 'update-check', 'update-install', 'start-capture', 'segment', 'dict', 'expr-check'];
const ALLOWED_ON = ['store-changed', 'quick-show', 'quick-close', 'config-changed', 'update-status', 'capture-show'];

contextBridge.exposeInMainWorld('native', {
  invoke: (ch, ...args) => (ALLOWED_INVOKE.includes(ch) ? ipcRenderer.invoke(ch, ...args) : Promise.reject(new Error('blocked'))),
  on: (ch, cb) => {
    if (ALLOWED_ON.includes(ch)) ipcRenderer.on(ch, (_e, payload) => cb(payload));
  },
});
