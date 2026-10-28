const { contextBridge, ipcRenderer, webUtils } = require('electron');
const inv = (c) => (...a) => ipcRenderer.invoke(c, ...a);
const listen = (c, check) => (cb) => {
  if (typeof cb !== 'function') return;
  ipcRenderer.on(c, (e, v) => { if (check(v)) cb(v); });
};
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.length < 4096;
contextBridge.exposeInMainWorld('api', {
  openMedia: inv('dialog:openMedia'), openSubs: inv('dialog:openSubs'), save: inv('dialog:save'), write: inv('file:write'),
  probe: inv('media:probe'), audio: inv('media:audio'), storeGet: inv('store:get'), storeSet: inv('store:set'), reveal: inv('shell:reveal'),
  burn: inv('export:burn'), cancelExport: inv('export:cancel'),
  onExportProgress: listen('export:progress', isNum),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f) || null; } catch { return null; } },
  project: {
    ready: inv('project:ready'), dirty: inv('project:dirty'), read: inv('project:read'), write: inv('project:write'), open: inv('dialog:openProject'),
    confirm: inv('dialog:confirm'), closeNow: inv('app:closeNow'),
    onOpen: listen('project:open', isStr), onMenu: listen('menu', isStr),
  },
  setUiLang: inv('ui:lang'),
  platform: process.platform,
  test: { config: inv('test:config'), shot: inv('test:shot'), done: inv('test:done'), menu: inv('test:menu') },
});
