const { app, BrowserWindow, screen, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const PANEL_WIDTH = 380;

let mainWindow;

// --- tiny JSON-file "storage" (replaces chrome.storage.local from the
// browser-extension version) -------------------------------------------
function storeFilePath() {
  return path.join(app.getPath("userData"), "overwatch-store.json");
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storeFilePath(), "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(data) {
  fs.writeFileSync(storeFilePath(), JSON.stringify(data, null, 2));
}

ipcMain.handle("storage:get", (_event, toolId) => {
  return readStore()[toolId] ?? null;
});

ipcMain.handle("storage:set", (_event, toolId, url) => {
  const store = readStore();
  store[toolId] = url;
  writeStore(store);
});

// --- window: pinned to the right edge of the screen, like a docked panel
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay(); // excludes OS menu bar/taskbar

  mainWindow = new BrowserWindow({
    width: PANEL_WIDTH,
    height: workArea.height,
    x: workArea.x + workArea.width - PANEL_WIDTH,
    y: workArea.y,
    minWidth: 280,
    title: "TGDG Overwatch",
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "sidepanel.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
