"use client";

import { EMPTY_SNAPSHOT, errorForStatus, nextSnapshot, parseDismissed, pruneDismissed, type WatchSnapshot } from "@/lib/job-watch-view";

// One shared Job Watch checker for the whole page: the red/green bars and the status line both read from it,
// so the server is asked once (every 2 minutes, only while this tab is visible), never twice.

export interface WatchView {
  snapshot: WatchSnapshot;
  dismissed: Record<string, number>;
  now: number;
}

export const POLL_MS = 120_000;
export const TICK_MS = 30_000;
export const REFRESH_AFTER_MS = 30_000;
const STORAGE_KEY = "overwatch.jobwatch.dismissed";

const SERVER_VIEW: WatchView = { snapshot: EMPTY_SNAPSHOT, dismissed: {}, now: 0 };

let view: WatchView = SERVER_VIEW;
const listeners = new Set<() => void>();
let timers: { poll: ReturnType<typeof setInterval>; tick: ReturnType<typeof setInterval> } | null = null;
let checking = false;
let lastCheckAt = 0;

function readStored(now: number): Record<string, number> {
  try {
    return parseDismissed(window.localStorage.getItem(STORAGE_KEY), now);
  } catch {
    return {}; // storage blocked: dismissals just last until the page is reloaded
  }
}

function writeStored(dismissed: Record<string, number>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dismissed));
  } catch {
    /* fine: the bar is still hidden for this page */
  }
}

function set(next: Partial<WatchView>) {
  view = { ...view, ...next };
  listeners.forEach((l) => l());
}

export async function check(): Promise<void> {
  if (checking) return;
  checking = true;
  lastCheckAt = Date.now();
  try {
    let body: unknown = null;
    let error: string | null = null;
    try {
      const res = await fetch("/api/job-watch", { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (res.redirected || res.status === 401) error = errorForStatus(401);
      else if (res.ok) body = await res.json();
      else error = errorForStatus(res.status);
    } catch {
      error = "Can't reach the console.";
    }
    const now = Date.now();
    set({ snapshot: nextSnapshot(view.snapshot, { body, error }, new Date(now).toISOString()), now });
  } finally {
    checking = false;
  }
}

export function dismiss(id: string) {
  const now = Date.now();
  const dismissed = pruneDismissed({ ...view.dismissed, [id]: now }, now);
  writeStored(dismissed);
  set({ dismissed, now });
}

function whenVisible() {
  if (document.visibilityState !== "hidden") void check();
}

function onFocusOrShow() {
  if (document.visibilityState !== "hidden" && Date.now() - lastCheckAt > REFRESH_AFTER_MS) void check();
}

function onStorage(e: StorageEvent) {
  if (e.key === STORAGE_KEY) set({ dismissed: readStored(Date.now()) }); // a bar dismissed in another tab or the docked window
}

function start() {
  const now = Date.now();
  set({ dismissed: readStored(now), now });
  void check();
  timers = {
    poll: setInterval(whenVisible, POLL_MS),
    tick: setInterval(() => set({ now: Date.now() }), TICK_MS), // the minutes on the job keep counting between checks
  };
  document.addEventListener("visibilitychange", onFocusOrShow);
  window.addEventListener("focus", onFocusOrShow);
  window.addEventListener("storage", onStorage);
}

function stop() {
  if (!timers) return;
  clearInterval(timers.poll);
  clearInterval(timers.tick);
  timers = null;
  document.removeEventListener("visibilitychange", onFocusOrShow);
  window.removeEventListener("focus", onFocusOrShow);
  window.removeEventListener("storage", onStorage);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

export const getView = (): WatchView => view;
export const getServerView = (): WatchView => SERVER_VIEW;

/** Tests only: back to the starting state. */
export function __resetForTests() {
  stop();
  listeners.clear();
  view = SERVER_VIEW;
  checking = false;
  lastCheckAt = 0;
}
