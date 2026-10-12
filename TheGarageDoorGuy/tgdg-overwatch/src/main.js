const { app, BrowserWindow, WebContentsView, screen, ipcMain, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const L = require("./shell-logic");
const { TOOLS } = require("./tools");

// TGDG Overwatch: a panel docked against the right edge of the screen, with one tab per tool.
// It cannot be dragged away, it re-docks itself when the screens change, and it remembers its width and screen.

const TOOL_IDS = TOOLS.map((t) => t.id);
const toolById = (id) => TOOLS.find((t) => t.id === id) || null;

let mainWindow = null;
let settings = null;
const views = new Map(); // toolId -> { view, url }
let activeToolId = null;
let chromeHeight = 0; // height of the panel's own header, measured by the panel and reported over IPC
let overlayOpen = false; // the burger menu is showing instead of the tool

// ---- who is signed in as admin ---------------------------------------------------------------------
// The sign-in is a cookie that lives with the tool pages. The panel never sees it; it asks the server a plain
// yes-or-no ("/api/admin/session") through the SAME session the tool pages use. Anything other than a clear
// "yes" counts as "no", so the settings cog and the Reports tab stay hidden unless the server confirms.
const ADMIN_CHECK_EVERY_MS = Number(process.env.OVERWATCH_ADMIN_CHECK_MS) > 0 ? Number(process.env.OVERWATCH_ADMIN_CHECK_MS) : 5 * 60 * 1000;
let adminSignedIn = false;
let adminReady = Promise.resolve();
let adminChecking = null;
let adminCheckAgain = false;
let adminCheckTimer = null;

async function checkAdmin() {
  if (adminChecking) {
    adminCheckAgain = true; // something changed while we were asking: ask once more afterwards
    return adminChecking;
  }
  adminChecking = (async () => {
    let signedIn = false;
    try {
      const res = await session.defaultSession.fetch(L.joinUrl(settings.serverUrl, "/api/admin/session"), {
        credentials: "include",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const body = await res.json();
        signedIn = !!body && body.signedIn === true;
      }
    } catch {
      signedIn = false; // can't reach the server or can't read the answer: not signed in
    }
    setAdminSignedIn(signedIn);
  })().finally(() => {
    adminChecking = null;
    if (adminCheckAgain) {
      adminCheckAgain = false;
      void checkAdmin();
    }
  });
  return adminChecking;
}

function scheduleAdminCheck() {
  clearTimeout(adminCheckTimer);
  adminCheckTimer = setTimeout(() => void checkAdmin(), 250);
}

function setAdminSignedIn(value) {
  if (value === adminSignedIn) return;
  adminSignedIn = value;
  if (!value) {
    // Signed out (or the session ran out): forget every admin-only page, and move off one if it was showing.
    for (const tool of TOOLS) if (tool.adminOnly) disposeView(tool.id);
    const active = toolById(activeToolId);
    if (active && active.adminOnly) {
      activeToolId = null;
      showTool(TOOLS.find((t) => t.core).id);
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("admin:changed", { adminSignedIn, activeTool: activeToolId });
}

// ---- settings file ---------------------------------------------------------------------------------

function storeFilePath() {
  return path.join(app.getPath("userData"), "overwatch-store.json");
}

function readSettings() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(storeFilePath(), "utf-8"));
  } catch {
    /* first run, or an unreadable file: start from defaults */
  }
  return L.normalizeSettings(raw, TOOL_IDS);
}

function writeSettings() {
  const file = storeFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2));
  fs.renameSync(temp, file); // never leave a half-written file behind
}

// ---- docking ---------------------------------------------------------------------------------------

function currentDisplay() {
  return L.pickDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay().id, settings.window.displayId);
}

function desiredBounds() {
  return L.dockBounds(currentDisplay().workArea, settings.window.width);
}

function dockInfo() {
  const displays = screen.getAllDisplays();
  const ordered = [...displays].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  const here = currentDisplay();
  return { width: mainWindow ? mainWindow.getBounds().width : settings.window.width, displayCount: displays.length, displayIndex: Math.max(0, ordered.findIndex((d) => d.id === here.id)) };
}

function notifyPanel() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("dock:changed", dockInfo());
}

/** Puts the window back against the right edge of its screen if it is anywhere else. */
function dock() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const want = desiredBounds();
  if (!L.sameBounds(mainWindow.getBounds(), want)) {
    mainWindow.setBounds(want);
    layoutViews();
    notifyPanel();
  }
}

let dockTimer = null;
function scheduleDock() {
  clearTimeout(dockTimer);
  dockTimer = setTimeout(dock, 120);
}

// ---- tool pages --------------------------------------------------------------------------------------

const isWebUrl = (text) => {
  try {
    const p = new URL(text);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
};
const originOf = (text) => {
  try {
    return new URL(text).origin;
  } catch {
    return null;
  }
};
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function errorPage(url, description) {
  const html = `<!doctype html><meta charset="utf-8"><title>Can't reach</title>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f4f2ea;color:#16140f;padding:28px;line-height:1.45">
<h2 style="margin:0 0 8px;font-size:18px">Can't reach this tool</h2>
<p style="margin:0 0 12px;color:#4a473e">${escapeHtml(url)}</p>
<p style="margin:0 0 12px">Is the server running? On the computer that hosts it, start it with <b>npm run dev</b>, then press the reload button above.</p>
<p style="margin:0 0 12px;color:#4a473e;font-size:12px">(${escapeHtml(description)})</p>
<p style="margin:0 0 18px;font-size:12px;color:#4a473e">Wrong address? An admin can change it from the Admin tab, or by editing this file: <b>${escapeHtml(storeFilePath())}</b></p>
<a href="${escapeHtml(url)}" style="display:inline-block;background:#e97530;color:#16140f;font-weight:700;padding:10px 16px;border-radius:6px;text-decoration:none">Try again</a>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** Each tool is its own real web page (not an embedded frame), so sign-ins and cookies work normally. */
function ensureView(tool) {
  const url = L.toolUrl(tool, settings);
  const existing = views.get(tool.id);
  if (existing && existing.url === url) return existing;
  if (existing) disposeView(tool.id);

  const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const contents = view.webContents;
  const origin = originOf(url);
  contents.setWindowOpenHandler(({ url: target }) => {
    if (isWebUrl(target)) shell.openExternal(target); // links that open a new window go to the real browser
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, target) => {
    if (target.startsWith("data:")) return;
    if (!isWebUrl(target) || originOf(target) !== origin) {
      event.preventDefault(); // a tool stays on its own site; anything else opens in the browser
      if (isWebUrl(target)) shell.openExternal(target);
    }
  });
  contents.on("did-finish-load", scheduleAdminCheck);
  contents.on("did-fail-load", (_event, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 means "I cancelled it myself"
    contents.loadURL(errorPage(failedUrl || url, description));
  });
  mainWindow.contentView.addChildView(view);
  contents.loadURL(url);
  const entry = { view, url };
  views.set(tool.id, entry);
  return entry;
}

function disposeView(toolId) {
  const entry = views.get(toolId);
  if (!entry) return;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(entry.view);
    entry.view.webContents.close();
  } catch {
    /* already gone */
  }
  views.delete(toolId);
}

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  const bounds = L.toolBounds({ width, height }, chromeHeight);
  for (const [id, entry] of views) {
    entry.view.setBounds(bounds);
    entry.view.setVisible(id === activeToolId && !overlayOpen);
  }
}

function showTool(toolId) {
  const tool = toolById(toolId);
  if (!tool || (!tool.core && settings.hiddenTools.includes(toolId))) return false;
  if (tool.adminOnly && !adminSignedIn) return false;
  ensureView(tool);
  activeToolId = toolId;
  if (settings.lastTool !== toolId) {
    settings.lastTool = toolId;
    writeSettings();
  }
  layoutViews();
  return true;
}

// ---- messages from the panel's own page --------------------------------------------------------------

function publicSettings() {
  const info = dockInfo();
  return {
    serverUrl: settings.serverUrl,
    hiddenTools: settings.hiddenTools,
    lastTool: settings.lastTool,
    adminSignedIn,
    width: info.width,
    widthPresets: L.WIDTH_PRESETS,
    displayCount: info.displayCount,
    displayIndex: info.displayIndex,
    urls: Object.fromEntries(TOOLS.map((t) => [t.id, L.toolUrl(t, settings)])),
  };
}

// Only the panel's own page may talk to us (the tool pages get no preload, so they cannot anyway).
const fromPanel = (event) => !!mainWindow && event.sender === mainWindow.webContents;
const NOT_ADMIN = { ok: false, error: "Sign in as admin to change panel settings." };

ipcMain.handle("settings:get", async (event) => {
  if (!fromPanel(event)) return null;
  await adminReady; // so the panel starts with the right tabs, not a flash of the wrong ones
  return publicSettings();
});

ipcMain.handle("tool:show", (event, toolId) => (fromPanel(event) ? { ok: showTool(toolId) } : { ok: false }));

ipcMain.handle("tool:reload", (event) => {
  if (!fromPanel(event) || !activeToolId) return { ok: false };
  const entry = views.get(activeToolId);
  if (!entry) return { ok: false };
  entry.view.webContents.loadURL(entry.url); // also recovers from the "can't reach" page
  return { ok: true };
});

ipcMain.handle("settings:setServer", (event, input) => {
  if (!fromPanel(event)) return { ok: false, error: "Not allowed." };
  if (!adminSignedIn) return NOT_ADMIN;
  const result = L.normalizeServerUrl(input);
  if (!result.ok) return result;
  settings.serverUrl = result.url;
  writeSettings();
  for (const tool of TOOLS) {
    const entry = views.get(tool.id);
    if (entry && entry.url !== L.toolUrl(tool, settings)) disposeView(tool.id);
  }
  if (activeToolId) showTool(activeToolId);
  scheduleAdminCheck(); // a different server has its own sign-in
  return { ok: true, url: result.url };
});

ipcMain.handle("settings:setHidden", (event, toolId, hidden) => {
  if (!fromPanel(event)) return { ok: false };
  if (!adminSignedIn) return NOT_ADMIN;
  const tool = toolById(toolId);
  if (!tool || tool.core || tool.adminOnly) return { ok: false, error: "That tab can't be hidden." };
  const set = new Set(settings.hiddenTools);
  if (hidden) set.add(toolId);
  else set.delete(toolId);
  settings.hiddenTools = [...set];
  writeSettings();
  if (hidden) {
    disposeView(toolId);
    if (activeToolId === toolId) {
      activeToolId = null;
      showTool(TOOLS.find((t) => t.core).id);
    }
  }
  return { ok: true, hiddenTools: settings.hiddenTools, activeTool: activeToolId };
});

ipcMain.handle("window:setWidth", (event, width) => {
  if (!fromPanel(event)) return { ok: false };
  if (!adminSignedIn) return NOT_ADMIN;
  settings.window.width = L.clampWidth(width, currentDisplay().workArea.width);
  writeSettings();
  dock();
  return { ok: true, ...dockInfo() };
});

ipcMain.handle("window:nextScreen", (event) => {
  if (!fromPanel(event)) return { ok: false };
  if (!adminSignedIn) return NOT_ADMIN;
  const next = L.nextDisplay(screen.getAllDisplays(), currentDisplay().id);
  if (next) {
    settings.window.displayId = next.id;
    writeSettings();
    dock();
  }
  return { ok: true, ...dockInfo() };
});

ipcMain.on("layout:set", (event, layout) => {
  if (!fromPanel(event) || !layout || typeof layout !== "object") return;
  const height = Number(layout.chromeHeight);
  if (Number.isFinite(height) && height >= 0 && height < 4000) chromeHeight = height;
  overlayOpen = layout.overlay === true;
  layoutViews();
});

// ---- window ------------------------------------------------------------------------------------------

function createWindow() {
  settings = readSettings();
  mainWindow = new BrowserWindow({
    ...desiredBounds(),
    minWidth: L.MIN_WIDTH,
    title: "TGDG Overwatch",
    alwaysOnTop: true,
    movable: false, // docked means docked: it cannot be dragged off
    resizable: false, // the width comes from the Narrow / Standard / Wide buttons
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true, // no File/Edit/View strip eating the top of a narrow panel (Windows and Linux)
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  adminReady = checkAdmin();
  mainWindow.setAlwaysOnTop(true, "floating");
  if (process.platform === "darwin") mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // If anything moves it (a window manager, a display change, a restore), put it back.
  for (const name of ["move", "moved", "resized", "show", "restore"]) mainWindow.on(name, scheduleDock);
  mainWindow.on("resize", layoutViews);
  mainWindow.on("focus", scheduleAdminCheck);
  mainWindow.on("closed", () => {
    mainWindow = null;
    views.clear();
    activeToolId = null;
  });

  mainWindow.loadFile(path.join(__dirname, "sidepanel.html"));
}

if (!app.requestSingleInstanceLock()) {
  app.quit(); // already running: the first copy is brought forward below
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    createWindow();
    for (const name of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(name, scheduleDock);
    // Signing in or out (or the cookie running out) changes the cookie: look again right away.
    session.defaultSession.cookies.on("changed", (_event, cookie) => {
      if (cookie.name === "overwatch_admin") scheduleAdminCheck();
    });
    // ...and look again every few minutes, which catches a password change or a session running out.
    setInterval(() => void checkAdmin(), ADMIN_CHECK_EVERY_MS).unref();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
