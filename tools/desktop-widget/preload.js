const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("panda", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (input) => ipcRenderer.invoke("config:save", input),
  resetConfig: () => ipcRenderer.invoke("config:reset"),
  fetchSummary: () => ipcRenderer.invoke("summary:fetch"),
  openLink: (relativePath) => ipcRenderer.invoke("link:open", relativePath),
  hide: () => ipcRenderer.invoke("window:minimize"),
  onSummary: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on("summary:update", listener);
    return () => ipcRenderer.removeListener("summary:update", listener);
  },
});
