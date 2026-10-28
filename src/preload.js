const { contextBridge, ipcRenderer, webUtils } = require('electron');
const inv = (c) => (...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('api', {
  openMedia: inv('dialog:openMedia'), openSubs: inv('dialog:openSubs'), save: inv('dialog:save'), write: inv('file:write'),
  probe: inv('media:probe'), audio: inv('media:audio'), storeGet: inv('store:get'), storeSet: inv('store:set'), reveal: inv('shell:reveal'),
  burn: inv('export:burn'), cancelExport: inv('export:cancel'),
  onExportProgress: (cb) => ipcRenderer.on('export:progress', (e, p) => cb(p)),
  pathForFile: (f) => webUtils.getPathForFile(f),
  project: { ready: inv('project:ready'), dirty: inv('project:dirty'), read: inv('project:read'), write: inv('project:write'), open: inv('dialog:openProject'),
    exists: inv('fs:exists'), confirm: inv('dialog:confirm'), closeNow: inv('app:closeNow'),
    onOpen: (cb) => ipcRenderer.on('project:open', (e, p) => cb(p)), onMenu: (cb) => ipcRenderer.on('menu', (e, c) => cb(c)) },
  setUiLang: inv('ui:lang'),
  platform: process.platform,
  test: { config: inv('test:config'), shot: inv('test:shot'), done: inv('test:done'), menu: inv('test:menu') },
});
