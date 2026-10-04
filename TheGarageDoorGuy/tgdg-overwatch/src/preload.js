const { contextBridge, ipcRenderer } = require("electron");

// Exposed to sidepanel.js as window.overwatch — replaces the chrome.storage
// calls the browser-extension version used.
contextBridge.exposeInMainWorld("overwatch", {
  getToolUrl: (toolId) => ipcRenderer.invoke("storage:get", toolId),
  setToolUrl: (toolId, url) => ipcRenderer.invoke("storage:set", toolId, url),
});
