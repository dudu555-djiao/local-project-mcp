const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('localReaderForm', {
  load: () => ipcRenderer.invoke('localreader:form-load'),
  save: value => ipcRenderer.invoke('localreader:form-save', value),
  cancel: () => ipcRenderer.invoke('localreader:form-cancel')
});
