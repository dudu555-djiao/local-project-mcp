const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('localReader', {
  platform: 'windows',
  postMessage: message => ipcRenderer.invoke('localreader:action', message),
  onEvent: callback => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('localreader:event', (_event, value) => callback(value));
  }
});
