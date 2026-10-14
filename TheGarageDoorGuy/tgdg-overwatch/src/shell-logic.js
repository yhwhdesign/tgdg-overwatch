// Decisions the docked panel makes, kept free of Electron and the DOM so they can be tested on their own.
// Loaded two ways: require("./shell-logic") from the main process, and a plain <script> tag in the panel
// (where it appears as window.ShellLogic).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShellLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DEFAULT_SERVER = "http://localhost:3000";
  const DEFAULT_WIDTH = 380;
  const MIN_WIDTH = 280;
  const MAX_WIDTH = 640;
  /** The panel never takes more than this share of a screen, however wide it is asked to be. */
  const MAX_SHARE = 0.6;

  const WIDTH_PRESETS = [
    { id: "narrow", label: "Narrow", width: 320 },
    { id: "standard", label: "Standard", width: 380 },
    { id: "wide", label: "Wide", width: 520 },
  ];

  // ---- docking ---------------------------------------------------------------------------------

  function clampWidth(width, workAreaWidth) {
    const n = Number(width);
    const wanted = Number.isFinite(n) ? n : DEFAULT_WIDTH;
    const ceiling = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor((workAreaWidth || MAX_WIDTH) * MAX_SHARE)));
    return Math.round(Math.min(Math.max(wanted, MIN_WIDTH), ceiling));
  }

  /** The window rectangle for a panel docked against the RIGHT edge of a screen's usable area (below the menu bar, above the taskbar). */
  function dockBounds(workArea, width) {
    const w = clampWidth(width, workArea.width);
    return { x: workArea.x + workArea.width - w, y: workArea.y, width: w, height: workArea.height };
  }

  /** The chosen screen if it still exists, otherwise the main one, otherwise whatever is there. */
  function pickDisplay(displays, primaryId, preferredId) {
    if (!displays || displays.length === 0) return null;
    return (
      displays.find((d) => preferredId !== null && preferredId !== undefined && d.id === preferredId) ||
      displays.find((d) => d.id === primaryId) ||
      displays[0]
    );
  }

  /** The next screen in left-to-right, then top-to-bottom order, wrapping around. */
  function nextDisplay(displays, currentId) {
    if (!displays || displays.length === 0) return null;
    const ordered = [...displays].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
    const at = ordered.findIndex((d) => d.id === currentId);
    return ordered[(at + 1) % ordered.length];
  }

  /** Where a tool's page goes: everything below the panel's own header, filling the rest of the window. */
  function toolBounds(contentSize, chromeHeight) {
    const top = Math.max(0, Math.round(chromeHeight || 0));
    return { x: 0, y: top, width: Math.max(0, contentSize.width), height: Math.max(0, contentSize.height - top) };
  }

  function sameBounds(a, b) {
    return !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }

  // ---- tabs ------------------------------------------------------------------------------------

  const GLYPH_TAB_PX = 36; // a square glyph tab plus its gap
  const MENU_BUTTON_PX = 40;
  const nameTabPx = (tool) => String(tool.shortName || tool.name || "").length * 7 + 32;

  /**
   * Which tabs to draw in `availableWidth` pixels. Prefers tabs with names, then glyph-only tabs, then moves the
   * extras behind a burger menu. The active tool is always kept visible.
   */
  function layoutTabs(tools, activeId, availableWidth) {
    const list = tools || [];
    const width = Number.isFinite(availableWidth) && availableWidth > 0 ? availableWidth : 0;
    if (width === 0 || list.reduce((sum, t) => sum + nameTabPx(t), 0) <= width) {
      return { mode: "names", visible: list, overflow: [], showMenu: false };
    }
    if (list.length * GLYPH_TAB_PX <= width) return { mode: "glyphs", visible: list, overflow: [], showMenu: false };

    const capacity = Math.max(1, Math.floor((width - MENU_BUTTON_PX) / GLYPH_TAB_PX));
    let visible = list.slice(0, capacity);
    if (!visible.some((t) => t.id === activeId)) {
      const active = list.find((t) => t.id === activeId);
      if (active) visible = [...visible.slice(0, capacity - 1), active];
    }
    const shown = new Set(visible.map((t) => t.id));
    return { mode: "glyphs", visible, overflow: list.filter((t) => !shown.has(t.id)), showMenu: true };
  }

  // ---- who sees what ----------------------------------------------------------------------------

  /** The tools to list: not hidden (a core tool can never be hidden), and admin-only tools only while signed in as admin. */
  function visibleTools(tools, hiddenTools, adminSignedIn) {
    const hidden = new Set(hiddenTools || []);
    return (tools || []).filter((t) => (t.core || !hidden.has(t.id)) && (!t.adminOnly || adminSignedIn === true));
  }

  /** The settings cog is for a signed-in admin, on the admin screen, and nobody else. */
  function settingsButtonVisible(adminSignedIn, activeTool) {
    return adminSignedIn === true && !!activeTool && activeTool.hostsPanelSettings === true;
  }

  // ---- addresses ---------------------------------------------------------------------------------

  /** Accepts an http or https address (adding http:// when the scheme is left off); refuses everything else (javascript:, file:, data:). */
  function normalizeServerUrl(input) {
    const text = String(input ?? "").trim();
    if (!text) return { ok: false, error: "Enter a web address, like http://localhost:3000." };
    // Anything that starts like a non-web scheme is refused outright, even when it could be read as host:port.
    if (/^(javascript|vbscript|data|file|blob|about|chrome|ftp|mailto|tel|ws|wss):/i.test(text)) {
      return { ok: false, error: "Only http and https addresses are allowed." };
    }
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/]+:\d+(\/|$)/.test(text) ? text : `http://${text}`;
    let parsed;
    try {
      parsed = new URL(withScheme);
    } catch {
      return { ok: false, error: "That doesn't look like a web address." };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "Only http and https addresses are allowed." };
    }
    if (!parsed.hostname) return { ok: false, error: "That doesn't look like a web address." };
    return { ok: true, url: `${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "")}` };
  }

  function joinUrl(server, path) {
    const base = String(server || DEFAULT_SERVER).replace(/\/+$/, "");
    const rest = String(path || "/");
    return rest === "/" ? base : `${base}${rest.startsWith("/") ? "" : "/"}${rest}`;
  }

  /** The address for a tool: its own override if it has one, otherwise the shared server address plus the tool's path. */
  function toolUrl(tool, settings) {
    const override = settings && settings.toolUrls && settings.toolUrls[tool.id];
    return override || joinUrl(settings && settings.serverUrl, tool.path);
  }

  // ---- Job Watch alerts ----------------------------------------------------------------------------

  const DISMISS_KEEP_MS = 24 * 60 * 60 * 1000;
  const MAX_DISMISSED = 200;

  /** "45m", "1h", "1h 40m". */
  function formatDuration(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    if (m < 60) return `${m}m`;
    return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  /** "Alex", "Alex and Blake", "Alex, Blake and Casey". */
  function joinNames(names) {
    const list = (names || []).filter(Boolean);
    if (list.length === 0) return "A technician";
    if (list.length === 1) return list[0];
    return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  }

  /** The two lines shown on the alert bar. The time on the job keeps counting between checks (it is worked out from the start time). */
  function alertMessage(alert, nowMs) {
    const techs = alert.techs || [];
    const started = Date.parse(alert.startedAt);
    const counted = Number.isFinite(started) ? Math.floor((nowMs - started) / 60000) : 0;
    const minutes = Math.max(Number(alert.minutesOnJob) || 0, counted);
    return {
      title: `${joinNames(techs)} ${techs.length > 1 ? "have" : "has"} been on "${alert.label}" for ${formatDuration(minutes)}`,
      detail: `Longer than the normal ${formatDuration(alert.limitMinutes)}. Started ${alert.startedLabel || "earlier"}. Click to dismiss.`,
    };
  }

  /** Whatever the server sent, reduced to well-formed alerts (so a surprise in its answer can never break the panel). */
  function cleanAlerts(list) {
    const number = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const out = [];
    for (const a of Array.isArray(list) ? list.slice(0, 30) : []) {
      if (!a || typeof a !== "object" || typeof a.id !== "string" || a.id.length === 0 || a.id.length > 120) continue;
      out.push({
        id: a.id,
        kind: a.kind === "install" ? "install" : "service",
        label: String(a.label == null ? "Job" : a.label).slice(0, 60),
        techs: (Array.isArray(a.techs) ? a.techs : []).filter((t) => typeof t === "string" && t.trim()).slice(0, 6).map((t) => t.slice(0, 60)),
        startedAt: typeof a.startedAt === "string" ? a.startedAt.slice(0, 40) : "",
        startedLabel: typeof a.startedLabel === "string" ? a.startedLabel.slice(0, 12) : "",
        minutesOnJob: number(a.minutesOnJob),
        limitMinutes: number(a.limitMinutes),
      });
    }
    return out;
  }

  /** Finished-job notifications from the server, reduced to well-formed ones (a surprise in its answer can never break the panel). */
  function cleanCompletions(list) {
    const out = [];
    for (const c of Array.isArray(list) ? list.slice(0, 20) : []) {
      if (!c || typeof c !== "object" || typeof c.id !== "string" || c.id.length === 0 || c.id.length > 120) continue;
      const minutes = c.minutesOnJob == null ? null : Number(c.minutesOnJob);
      out.push({
        id: c.id,
        kind: c.kind === "install" ? "install" : "service",
        label: String(c.label == null ? "Job" : c.label).slice(0, 60),
        techs: (Array.isArray(c.techs) ? c.techs : []).filter((t) => typeof t === "string" && t.trim()).slice(0, 6).map((t) => t.slice(0, 60)),
        completedAt: typeof c.completedAt === "string" ? c.completedAt.slice(0, 40) : "",
        completedLabel: typeof c.completedLabel === "string" ? c.completedLabel.slice(0, 12) : "",
        minutesOnJob: minutes !== null && Number.isFinite(minutes) ? Math.max(0, minutes) : null,
        notes: (Array.isArray(c.notes) ? c.notes : []).filter((t) => typeof t === "string" && t.trim()).slice(-3).map((t) => t.trim().slice(0, 320)),
        notesPending: c.notesPending === true,
        notesHidden: c.notesHidden === true,
      });
    }
    return out;
  }

  /** What a "finished" bar says: who finished what, when and after how long, then the notes (or why there are none). */
  function completionMessage(c) {
    const took = c.minutesOnJob == null ? "" : ` after ${formatDuration(c.minutesOnJob)}`;
    const hasNotes = !c.notesHidden && c.notes.length > 0;
    const notes = c.notesHidden
      ? "Notes are turned off."
      : hasNotes
        ? c.notes.join("\n")
        : c.notesPending
          ? "No notes yet. They will appear here if the tech adds them."
          : "No notes were left.";
    return { title: `${joinNames(c.techs)} finished "${c.label}"`, detail: `Finished ${c.completedLabel || "just now"}${took}.`, notes, hasNotes };
  }

  /** Alerts that have not been clicked away. */
  function undismissedAlerts(alerts, dismissed) {
    const gone = dismissed && typeof dismissed === "object" ? dismissed : {};
    return (alerts || []).filter((a) => a && typeof a.id === "string" && !Object.prototype.hasOwnProperty.call(gone, a.id));
  }

  /** Forgets dismissals older than a day (an alert is about one job on one day) and keeps the list small. */
  function pruneDismissed(dismissed, nowMs) {
    const kept = [];
    for (const [id, at] of Object.entries(dismissed && typeof dismissed === "object" ? dismissed : {})) {
      if (typeof id === "string" && id.length > 0 && id.length <= 120 && Number.isFinite(at) && nowMs - at < DISMISS_KEEP_MS && at <= nowMs + 60000) kept.push([id, at]);
    }
    kept.sort((a, b) => b[1] - a[1]);
    return Object.fromEntries(kept.slice(0, MAX_DISMISSED));
  }

  // ---- saved settings ----------------------------------------------------------------------------

  /**
   * Turns whatever is in the settings file into a complete, valid settings object. Understands the OLD format
   * (just { toolId: url }) and keeps its address as the shared server address.
   */
  function normalizeSettings(raw, knownToolIds, nowMs = Date.now()) {
    const data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const known = new Set(knownToolIds || []);
    const settings = { version: 2, serverUrl: DEFAULT_SERVER, toolUrls: {}, hiddenTools: [], lastTool: null, window: { width: DEFAULT_WIDTH, displayId: null }, jobWatchDismissed: {} };

    if (data.version === 2) {
      const server = normalizeServerUrl(data.serverUrl);
      if (typeof data.serverUrl === "string" && server.ok) settings.serverUrl = server.url;
      if (data.toolUrls && typeof data.toolUrls === "object") {
        for (const [id, url] of Object.entries(data.toolUrls)) {
          const ok = normalizeServerUrl(url);
          if (known.has(id) && typeof url === "string" && ok.ok) settings.toolUrls[id] = ok.url;
        }
      }
      if (Array.isArray(data.hiddenTools)) settings.hiddenTools = [...new Set(data.hiddenTools.filter((id) => typeof id === "string" && known.has(id)))];
      if (typeof data.lastTool === "string" && known.has(data.lastTool)) settings.lastTool = data.lastTool;
      const w = data.window && typeof data.window === "object" ? data.window : {};
      settings.window.width = clampWidth(w.width, MAX_WIDTH / MAX_SHARE);
      if (typeof w.displayId === "number" || typeof w.displayId === "string") settings.window.displayId = w.displayId;
      settings.jobWatchDismissed = pruneDismissed(data.jobWatchDismissed, nowMs);
      return settings;
    }

    // old format: { dispatch: "http://localhost:3000" }
    const legacy = typeof data.dispatch === "string" ? normalizeServerUrl(data.dispatch) : null;
    if (legacy && legacy.ok) {
      try {
        settings.serverUrl = new URL(legacy.url).origin;
      } catch {
        /* keep the default */
      }
    }
    return settings;
  }

  return {
    DEFAULT_SERVER,
    DEFAULT_WIDTH,
    MIN_WIDTH,
    MAX_WIDTH,
    WIDTH_PRESETS,
    clampWidth,
    dockBounds,
    pickDisplay,
    nextDisplay,
    toolBounds,
    sameBounds,
    layoutTabs,
    formatDuration,
    joinNames,
    alertMessage,
    cleanAlerts,
    cleanCompletions,
    completionMessage,
    undismissedAlerts,
    pruneDismissed,
    visibleTools,
    settingsButtonVisible,
    normalizeServerUrl,
    joinUrl,
    toolUrl,
    normalizeSettings,
  };
});
