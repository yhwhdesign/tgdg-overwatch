// What the website shows for Job Watch (red "over time" bars, green "finished" bars, the small status line).
// The same wording and rules as the desktop panel (src/shell-logic.js), written here so the website needs no
// desktop code. It imports nothing, so it runs directly on Node in tests (tests/unit/job-watch-view.test.mts
// checks it gives the same answers as the panel's version).

export type AlertKind = "install" | "service" | "estimate";

export interface WatchAlert {
  id: string;
  kind: AlertKind;
  label: string;
  techs: string[];
  startedAt: string;
  startedLabel: string;
  minutesOnJob: number;
  limitMinutes: number;
  url: string | null;
}

export interface WatchDone {
  id: string;
  kind: AlertKind;
  label: string;
  techs: string[];
  completedAt: string;
  completedLabel: string;
  minutesOnJob: number | null;
  notes: string[];
  notesPending: boolean;
  notesHidden: boolean;
  url: string | null;
}

export const DISMISS_KEEP_MS = 24 * 60 * 60 * 1000;
export const MAX_DISMISSED = 200;
export const MAX_BARS_SHOWN = 3;
export const OFFLINE_AFTER_FAILURES = 3;

/** "45m", "1h", "1h 40m". */
export function formatDuration(minutes: unknown): string {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m}m`;
  return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "Alex", "Alex and Blake", "Alex, Blake and Casey". */
export function joinNames(names: unknown): string {
  const list = (Array.isArray(names) ? names : []).filter(Boolean) as string[];
  if (list.length === 0) return "A technician";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** A job link we are willing to open: https, on Housecall Pro's own site, no sign-in details, port or odd characters. Otherwise null. */
export function safeJobUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 300 || /[\u0000- \u007f]/.test(value)) return null;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (host !== "housecallpro.com" && !host.endsWith(".housecallpro.com")) return null;
  return u.href;
}

function kindOf(value: unknown): AlertKind {
  return value === "install" ? "install" : value === "estimate" ? "estimate" : "service";
}

function techList(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).filter((t) => typeof t === "string" && t.trim()).slice(0, 6).map((t: string) => t.slice(0, 60));
}

/** Whatever the server sent, reduced to well-formed alerts (a surprise in its answer can never break the page). */
export function cleanAlerts(list: unknown): WatchAlert[] {
  const number = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const out: WatchAlert[] = [];
  for (const a of (Array.isArray(list) ? list.slice(0, 30) : []) as Record<string, unknown>[]) {
    if (!a || typeof a !== "object" || typeof a.id !== "string" || a.id.length === 0 || a.id.length > 120) continue;
    out.push({
      id: a.id,
      kind: kindOf(a.kind),
      label: String(a.label == null ? "Job" : a.label).slice(0, 60),
      techs: techList(a.techs),
      startedAt: typeof a.startedAt === "string" ? a.startedAt.slice(0, 40) : "",
      startedLabel: typeof a.startedLabel === "string" ? a.startedLabel.slice(0, 12) : "",
      minutesOnJob: number(a.minutesOnJob),
      limitMinutes: number(a.limitMinutes),
      url: safeJobUrl(a.url),
    });
  }
  return out;
}

/** Finished-job entries from the server, reduced to well-formed ones. */
export function cleanCompletions(list: unknown): WatchDone[] {
  const out: WatchDone[] = [];
  for (const c of (Array.isArray(list) ? list.slice(0, 20) : []) as Record<string, unknown>[]) {
    if (!c || typeof c !== "object" || typeof c.id !== "string" || c.id.length === 0 || c.id.length > 120) continue;
    const minutes = c.minutesOnJob == null ? null : Number(c.minutesOnJob);
    out.push({
      id: c.id,
      kind: kindOf(c.kind),
      label: String(c.label == null ? "Job" : c.label).slice(0, 60),
      techs: techList(c.techs),
      completedAt: typeof c.completedAt === "string" ? c.completedAt.slice(0, 40) : "",
      completedLabel: typeof c.completedLabel === "string" ? c.completedLabel.slice(0, 12) : "",
      minutesOnJob: minutes !== null && Number.isFinite(minutes) ? Math.max(0, minutes) : null,
      notes: (Array.isArray(c.notes) ? c.notes : []).filter((t) => typeof t === "string" && t.trim()).slice(-3).map((t: string) => t.trim().slice(0, 320)),
      notesPending: c.notesPending === true,
      notesHidden: c.notesHidden === true,
      url: safeJobUrl(c.url),
    });
  }
  return out;
}

/** The two lines on a red bar. The time on the job keeps counting between checks (worked out from the start time). */
export function alertMessage(alert: WatchAlert, nowMs: number): { title: string; detail: string } {
  const techs = alert.techs || [];
  const started = Date.parse(alert.startedAt);
  const counted = Number.isFinite(started) ? Math.floor((nowMs - started) / 60000) : 0;
  const minutes = Math.max(Number(alert.minutesOnJob) || 0, counted);
  if (alert.kind === "estimate") {
    const waitedDays = Math.floor(minutes / 1440);
    return {
      title: `${alert.label} has had no answer for ${waitedDays} ${waitedDays === 1 ? "day" : "days"}`,
      detail: `Created ${alert.startedLabel || "earlier"}${techs.length ? ` (${joinNames(techs)})` : ""}. No option is approved or declined yet.`,
    };
  }
  return {
    title: `${joinNames(techs)} ${techs.length > 1 ? "have" : "has"} been on "${alert.label}" for ${formatDuration(minutes)}`,
    detail: `Longer than the normal ${formatDuration(alert.limitMinutes)}. Started ${alert.startedLabel || "earlier"}.`,
  };
}

/** What a green "finished" bar says: who finished what, when and after how long, then the notes (or why there are none). */
export function completionMessage(c: WatchDone): { title: string; detail: string; notes: string; hasNotes: boolean } {
  const took = c.minutesOnJob == null ? "" : ` after ${formatDuration(c.minutesOnJob)}`;
  const hasNotes = !c.notesHidden && c.notes.length > 0;
  const isEstimate = c.kind === "estimate";
  const notes = c.notesHidden
    ? "Notes are turned off."
    : hasNotes
      ? c.notes.join("\n")
      : c.notesPending
        ? isEstimate
          ? "No options on it yet. They will appear here once the tech adds them."
          : "No notes yet. They will appear here if the tech adds them."
        : isEstimate
          ? "No options were added."
          : "No notes were left.";
  return { title: `${joinNames(c.techs)} finished "${c.label}"`, detail: `Finished ${c.completedLabel || "just now"}${took}.`, notes, hasNotes };
}

/** Forgets dismissals older than a day (an alert is about one job on one day) and keeps the list small. */
export function pruneDismissed(dismissed: unknown, nowMs: number): Record<string, number> {
  const kept: [string, number][] = [];
  for (const [id, at] of Object.entries(dismissed && typeof dismissed === "object" ? (dismissed as Record<string, unknown>) : {})) {
    if (typeof at === "number" && id.length > 0 && id.length <= 120 && Number.isFinite(at) && nowMs - at < DISMISS_KEEP_MS && at <= nowMs + 60000) kept.push([id, at]);
  }
  kept.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(kept.slice(0, MAX_DISMISSED));
}

/** Reads the saved dismissals text (from the browser's storage); anything unreadable means "none". */
export function parseDismissed(raw: string | null | undefined, nowMs: number): Record<string, number> {
  if (!raw) return {};
  try {
    return pruneDismissed(JSON.parse(raw), nowMs);
  } catch {
    return {};
  }
}

export type BarItem =
  | { type: "over"; id: string; message: { title: string; detail: string }; url: string | null; kind: AlertKind }
  | { type: "done"; id: string; message: { title: string; detail: string; notes: string; hasNotes: boolean }; url: string | null; kind: AlertKind };

/** The bars to draw: overtime alerts first (the urgent ones), then finished jobs; dismissed ones left out; at most `max` shown. */
export function buildBars(alerts: WatchAlert[], completed: WatchDone[], dismissed: Record<string, number>, nowMs: number, max: number = MAX_BARS_SHOWN): { shown: BarItem[]; more: number } {
  const gone = (id: string) => Object.prototype.hasOwnProperty.call(dismissed, id);
  const items: BarItem[] = [
    ...alerts.filter((a) => !gone(a.id)).map((a): BarItem => ({ type: "over", id: a.id, message: alertMessage(a, nowMs), url: a.url, kind: a.kind })),
    ...completed.filter((c) => !gone(c.id)).map((c): BarItem => ({ type: "done", id: c.id, message: completionMessage(c), url: c.url, kind: c.kind })),
  ];
  return { shown: items.slice(0, max), more: Math.max(0, items.length - max) };
}

export type WatchState = "starting" | "ok" | "trouble" | "offline";

export interface WatchSnapshot {
  state: WatchState;
  watching: number;
  cantTell: number;
  ignoredOlder: number;
  alerts: WatchAlert[];
  completed: WatchDone[];
  error: string | null;
  checkedAt: string | null;
  failures: number;
}

export const EMPTY_SNAPSHOT: WatchSnapshot = { state: "starting", watching: 0, cantTell: 0, ignoredOlder: 0, alerts: [], completed: [], error: null, checkedAt: null, failures: 0 };

/** The next snapshot after one check. A good answer replaces everything; a bad one keeps the last alerts and counts the failure. */
export function nextSnapshot(prev: WatchSnapshot, result: { body: unknown; error: string | null }, nowIso: string): WatchSnapshot {
  const body = result.body as Record<string, unknown> | null;
  if (body && typeof body === "object" && body.ok === true && Array.isArray(body.alerts)) {
    return {
      state: "ok",
      watching: Math.max(0, Number(body.watching) || 0),
      cantTell: Math.max(0, Number(body.cantTell) || 0),
      ignoredOlder: Math.max(0, Number(body.ignoredOlder) || 0),
      alerts: cleanAlerts(body.alerts),
      completed: cleanCompletions(body.completed),
      error: null,
      checkedAt: typeof body.checkedAt === "string" ? body.checkedAt : nowIso,
      failures: 0,
    };
  }
  const failures = prev.failures + 1;
  const message = result.error || (body && typeof body.error === "string" ? body.error.slice(0, 200) : "Job Watch could not check.");
  return { ...prev, state: failures >= OFFLINE_AFTER_FAILURES ? "offline" : "trouble", error: message, failures };
}

/** The small status line: "No one on a job", "2 on jobs", "Job Watch offline", and its tooltip. */
export function statusLine(s: WatchSnapshot, timeLabel: (iso: string) => string): { text: string; tone: "ok" | "trouble" | "offline"; title: string } {
  const text = s.state === "offline" ? "Job Watch offline" : s.watching === 0 ? "No one on a job" : `${s.watching} on ${s.watching === 1 ? "a job" : "jobs"}`;
  const parts: string[] = [];
  if (s.state === "offline" || s.state === "trouble") parts.push(`Job Watch can't check right now${s.error ? `: ${s.error}` : "."}`);
  if (s.checkedAt) parts.push(`Last checked ${timeLabel(s.checkedAt)}.`);
  if (s.cantTell > 0) parts.push(`${s.cantTell} job${s.cantTell === 1 ? "" : "s"} in progress ${s.cantTell === 1 ? "has" : "have"} no Start tap in Housecall Pro, so can't be watched.`);
  if (s.ignoredOlder > 0) parts.push(`${s.ignoredOlder} job${s.ignoredOlder === 1 ? "" : "s"} started on an earlier day (not judged).`);
  return { text, tone: s.state === "offline" ? "offline" : s.state === "trouble" ? "trouble" : "ok", title: parts.join(" ") };
}

/** Text for a failed check, from the HTTP status (the page signs in with the site's own cookie, so a 401 means the sign-in ran out). */
export function errorForStatus(status: number): string {
  if (status === 401) return "Sign in again to turn Job Watch on.";
  return `The console answered HTTP ${status}.`;
}
