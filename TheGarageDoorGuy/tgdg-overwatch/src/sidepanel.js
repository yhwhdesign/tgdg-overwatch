// The panel's own page: tabs, the burger menu, and the settings drawer. The tools themselves are NOT inside this
// page; the app places each one as a separate page below this header (see main.js).
// ShellLogic (shell-logic.js) and TOOLS (tools.js) are loaded just before this file.

const chrome = document.getElementById("chrome");
const tabbar = document.getElementById("tabbar");
const tabsEl = document.getElementById("tabs");
const menuBtn = document.getElementById("menu-btn");
const menuPanel = document.getElementById("menu-panel");
const nameLabel = document.getElementById("active-tool-name");
const reloadBtn = document.getElementById("reload-btn");
const settingsBtn = document.getElementById("toggle-settings");
const settingsEl = document.getElementById("settings");
const serverInput = document.getElementById("server-input");
const saveServerBtn = document.getElementById("save-server");
const settingsError = document.getElementById("settings-error");
const widthRow = document.getElementById("width-row");
const nextScreenBtn = document.getElementById("next-screen");
const tabsLabel = document.getElementById("tabs-label");
const tabToggles = document.getElementById("tab-toggles");
const alertsEl = document.getElementById("alerts");
const watchEl = document.getElementById("watch-status");

let settings = null; // what the app told us (see publicSettings in main.js)
let activeId = null;
let menuOpen = false;
let settingsOpen = false;
let reported = { height: -1, overlay: null };
let jobWatch = { state: "starting", watching: 0, cantTell: 0, ignoredOlder: 0, alerts: [], completed: [], error: null, checkedAt: null };
let alertsSignature = "";
const MAX_ALERTS_SHOWN = 3;

const visibleTools = () => ShellLogic.visibleTools(TOOLS, settings.hiddenTools, settings.adminSignedIn);
const activeTool = () => TOOLS.find((t) => t.id === activeId) || null;
/** The settings cog is for a signed-in admin, on the admin screen, and nobody else. */
const settingsAllowed = () => ShellLogic.settingsButtonVisible(settings.adminSignedIn, activeTool());

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderTabs() {
  const available = Math.max(0, tabbar.clientWidth - 16);
  const layout = ShellLogic.layoutTabs(visibleTools(), activeId, available);
  tabsEl.replaceChildren();
  for (const tool of layout.visible) {
    const tab = el("button", "tab" + (tool.id === activeId ? " active" : ""), layout.mode === "names" ? tool.shortName : tool.glyph);
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(tool.id === activeId));
    tab.dataset.tool = tool.id;
    tab.title = tool.name;
    tab.addEventListener("click", () => switchTool(tool.id));
    tabsEl.appendChild(tab);
  }
  menuBtn.hidden = !layout.showMenu;
  menuBtn.setAttribute("aria-expanded", String(menuOpen));
}

function renderMenu() {
  menuPanel.hidden = !menuOpen;
  if (!menuOpen) return;
  menuPanel.replaceChildren();
  for (const tool of visibleTools()) {
    const row = el("button", "menu-row" + (tool.id === activeId ? " active" : ""));
    row.type = "button";
    row.setAttribute("role", "menuitem");
    row.dataset.tool = tool.id;
    row.append(el("span", "glyph", tool.glyph), el("span", "name", tool.name), el("span", "mark", tool.id === activeId ? "\u25CF" : ""));
    row.addEventListener("click", () => switchTool(tool.id));
    menuPanel.appendChild(row);
  }
}

function renderSettings() {
  settingsEl.hidden = !settingsOpen;
  settingsBtn.setAttribute("aria-expanded", String(settingsOpen));
  if (!settingsOpen) return;

  widthRow.replaceChildren();
  for (const preset of settings.widthPresets) {
    const btn = el("button", "preset", preset.label);
    btn.type = "button";
    btn.dataset.width = String(preset.width);
    btn.setAttribute("aria-pressed", String(settings.width === preset.width));
    btn.addEventListener("click", async () => {
      await window.overwatch.setWidth(preset.width);
    });
    widthRow.appendChild(btn);
  }

  nextScreenBtn.hidden = settings.displayCount <= 1;
  nextScreenBtn.textContent = `Move to next screen (${settings.displayIndex + 1} of ${settings.displayCount})`;

  tabToggles.replaceChildren();
  const hideable = TOOLS.filter((t) => !t.core && !t.adminOnly);
  tabsLabel.hidden = hideable.length === 0;
  for (const tool of hideable) {
    const label = el("label", "toggle");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !settings.hiddenTools.includes(tool.id);
    box.dataset.tool = tool.id;
    box.addEventListener("change", async () => {
      const result = await window.overwatch.setToolHidden(tool.id, !box.checked);
      if (result && result.ok) {
        settings.hiddenTools = result.hiddenTools;
        if (result.activeTool) activeId = result.activeTool;
        render();
      } else {
        box.checked = !box.checked;
      }
    });
    label.append(box, document.createTextNode(` Show the ${tool.name} tab`));
    tabToggles.appendChild(label);
  }
}

// ---- Job Watch: bars across the top (click one to dismiss it) and a small status next to the tool name ---------

function renderAlerts() {
  const now = Date.now();
  // overtime alerts first (they are the urgent ones), then jobs that have just been finished
  const items = [
    ...(jobWatch.alerts || []).map((alert) => ({ type: "over", id: alert.id, message: ShellLogic.alertMessage(alert, now), url: alert.url || null, kind: alert.kind })),
    ...(jobWatch.completed || []).map((done) => ({ type: "done", id: done.id, message: ShellLogic.completionMessage(done), url: done.url || null, kind: done.kind })),
  ];
  const shown = items.slice(0, MAX_ALERTS_SHOWN);
  const signature = JSON.stringify([shown.map((x) => [x.type, x.id, x.message, Boolean(x.url)]), items.length]);
  if (signature === alertsSignature) return; // nothing changed: leave the buttons alone so a click is never lost mid-press
  alertsSignature = signature;
  alertsEl.replaceChildren();
  for (const { type, id, message, url, kind } of shown) {
    const bar = el("button", type === "done" ? "alert done" : "alert");
    bar.type = "button";
    bar.dataset.alert = id;
    bar.title = type === "done" && message.hasNotes ? message.notes : "Click to dismiss";
    bar.append(el("span", "alert-title", message.title), el("span", "alert-detail", message.detail));
    if (type === "done") bar.append(el("span", message.hasNotes ? "alert-notes" : "alert-notes none", message.notes), el("span", "alert-hint", "Click to dismiss."));
    bar.addEventListener("click", () => window.overwatch.dismissJobWatch(id));
    const wrap = el("div", type === "done" ? "alert-wrap done" : "alert-wrap");
    wrap.appendChild(bar);
    if (url) {
      // a separate button under the bar (a button inside a button is not valid), and it must not dismiss the bar
      const go = el("button", "alert-go", kind === "estimate" ? "Go to estimate" : "Go to job");
      go.type = "button";
      go.dataset.goto = id;
      go.title = kind === "estimate" ? "Open this estimate in Housecall Pro" : "Open this ticket in Housecall Pro";
      go.addEventListener("click", () => window.overwatch.openJobWatchJob(id));
      wrap.appendChild(go);
    }
    alertsEl.appendChild(wrap);
  }
  if (items.length > MAX_ALERTS_SHOWN) alertsEl.appendChild(el("div", "alert-more", `+${items.length - MAX_ALERTS_SHOWN} more (dismiss one to see the next)`));
}

function renderWatchStatus() {
  const w = jobWatch;
  watchEl.hidden = w.state === "starting";
  watchEl.className = `watch ${w.state === "offline" ? "offline" : w.state === "trouble" ? "trouble" : "ok"}`;
  watchEl.textContent = w.state === "offline" ? "Job Watch offline" : w.watching === 0 ? "No one on a job" : `${w.watching} on ${w.watching === 1 ? "a job" : "jobs"}`;
  const parts = [];
  if (w.state === "offline" || w.state === "trouble") parts.push(`Job Watch can't check right now${w.error ? `: ${w.error}` : "."}`);
  if (w.checkedAt) parts.push(`Last checked ${new Date(w.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
  if (w.cantTell > 0) parts.push(`${w.cantTell} job${w.cantTell === 1 ? "" : "s"} in progress ${w.cantTell === 1 ? "has" : "have"} no Start tap in Housecall Pro, so can't be watched.`);
  if (w.ignoredOlder > 0) parts.push(`${w.ignoredOlder} job${w.ignoredOlder === 1 ? "" : "s"} started on an earlier day (not judged).`);
  watchEl.title = parts.join(" ");
}

/** Tells the app how tall this header is (so the tool's page starts right below it) and whether the menu is covering the tool. */
function reportLayout() {
  const height = Math.ceil(chrome.getBoundingClientRect().height);
  if (height === reported.height && menuOpen === reported.overlay) return;
  reported = { height, overlay: menuOpen };
  window.overwatch.setLayout({ chromeHeight: height, overlay: menuOpen });
}

function render() {
  renderAlerts();
  renderWatchStatus();
  const tool = activeTool();
  nameLabel.textContent = tool ? tool.name : "";
  settingsBtn.hidden = !settingsAllowed();
  if (!settingsAllowed()) settingsOpen = false;
  renderTabs();
  renderMenu();
  renderSettings();
  reportLayout();
}

async function switchTool(id) {
  menuOpen = false;
  settingsOpen = false;
  settingsError.hidden = true;
  activeId = id;
  render();
  await window.overwatch.showTool(id);
}

menuBtn.addEventListener("click", () => {
  menuOpen = !menuOpen;
  if (menuOpen) settingsOpen = false;
  render();
});

settingsBtn.addEventListener("click", () => {
  if (!settingsAllowed()) return;
  settingsOpen = !settingsOpen;
  if (settingsOpen) {
    menuOpen = false;
    serverInput.value = settings.serverUrl;
    settingsError.hidden = true;
  }
  render();
});

reloadBtn.addEventListener("click", () => window.overwatch.reloadTool());

saveServerBtn.addEventListener("click", async () => {
  const result = ShellLogic.normalizeServerUrl(serverInput.value);
  if (!result.ok) {
    settingsError.textContent = result.error;
    settingsError.hidden = false;
    return;
  }
  const saved = await window.overwatch.setServerUrl(serverInput.value);
  if (!saved || !saved.ok) {
    settingsError.textContent = (saved && saved.error) || "Could not save that address.";
    settingsError.hidden = false;
    return;
  }
  settings.serverUrl = saved.url;
  settingsError.hidden = true;
  settingsOpen = false;
  render();
});

serverInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveServerBtn.click();
});

nextScreenBtn.addEventListener("click", () => window.overwatch.nextScreen());

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (menuOpen || settingsOpen) {
    menuOpen = false;
    settingsOpen = false;
    render();
  }
});

window.addEventListener("resize", render);
if (typeof ResizeObserver !== "undefined") new ResizeObserver(reportLayout).observe(chrome);

window.overwatch.onJobWatchChanged((info) => {
  jobWatch = info;
  renderAlerts();
  renderWatchStatus();
});
setInterval(renderAlerts, 30_000); // the minutes on the job keep counting between checks

window.overwatch.onAdminChanged((info) => {
  settings.adminSignedIn = info.adminSignedIn === true;
  if (info.activeTool && info.activeTool !== activeId) activeId = info.activeTool; // the app moved us off an admin-only tab
  if (!settings.adminSignedIn) settingsOpen = false;
  render();
});

window.overwatch.onDockChanged((info) => {
  settings.width = info.width;
  settings.displayCount = info.displayCount;
  settings.displayIndex = info.displayIndex;
  render();
});

(async function start() {
  settings = await window.overwatch.getSettings();
  if (settings.jobWatch) jobWatch = settings.jobWatch;
  const shown = visibleTools();
  const first = shown.find((t) => t.id === settings.lastTool) || shown[0];
  await switchTool(first.id);
})();
