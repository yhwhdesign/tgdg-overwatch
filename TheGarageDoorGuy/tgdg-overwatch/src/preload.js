const { contextBridge, ipcRenderer } = require("electron");

// The ONLY things the panel's own page may ask the app to do. The tools themselves (the dispatch console,
// the admin screen) load as separate pages that get no access to any of this.
contextBridge.exposeInMainWorld("overwatch", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  showTool: (id) => ipcRenderer.invoke("tool:show", id),
  reloadTool: () => ipcRenderer.invoke("tool:reload"),
  setServerUrl: (url) => ipcRenderer.invoke("settings:setServer", url),
  setToolHidden: (id, hidden) => ipcRenderer.invoke("settings:setHidden", id, hidden),
  setWidth: (width) => ipcRenderer.invoke("window:setWidth", width),
  nextScreen: () => ipcRenderer.invoke("window:nextScreen"),
  setLayout: (layout) => ipcRenderer.send("layout:set", layout),
  onAdminChanged: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on("admin:changed", handler);
    return () => ipcRenderer.removeListener("admin:changed", handler);
  },
  onDockChanged: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on("dock:changed", handler);
    return () => ipcRenderer.removeListener("dock:changed", handler);
  },
});
