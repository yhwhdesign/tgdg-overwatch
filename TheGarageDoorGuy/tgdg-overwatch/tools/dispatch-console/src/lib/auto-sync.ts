import { runFullSync, SyncBusyError } from "@/lib/run-sync";
import { createAutoSync, readAutoSyncConfig, type AutoSyncState } from "@/lib/auto-sync-controller";
import { describeSyncError, type AutoSyncInfo } from "@/lib/sync-status";

// Starts the automatic refresh once, when the server starts (see src/instrumentation.ts).
// Only meaningful on a server that stays running (your computer, a VPS). On serverless hosting nothing
// stays running, so use a scheduled call to /api/admin/hcp-sync there instead (see the README).

type Controller = ReturnType<typeof createAutoSync>;
const g = globalThis as { __tgdgAutoSync?: Controller; __tgdgAutoSyncOff?: string };

export function startAutoSync(env: Record<string, string | undefined> = process.env) {
  if (g.__tgdgAutoSync) return; // already running (the dev server can load this more than once)
  const config = readAutoSyncConfig(env);
  for (const warning of config.warnings) console.warn(`[auto-sync] ${warning}`);
  if (!config.enabled) {
    g.__tgdgAutoSyncOff = config.reason ?? "off";
    console.log(`[auto-sync] off (${g.__tgdgAutoSyncOff})`);
    return;
  }
  if (!env.HCP_API_KEY || !env.DATABASE_URL) {
    g.__tgdgAutoSyncOff = "HCP_API_KEY or DATABASE_URL is not set";
    console.log(`[auto-sync] off (${g.__tgdgAutoSyncOff})`);
    return;
  }
  const controller = createAutoSync({
    config,
    now: () => new Date(),
    setTimer: (fn, ms) => {
      const handle = setTimeout(() => void fn(), ms);
      handle.unref?.(); // never keep the server alive just for the timer
      return handle;
    },
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    log: (message) => console.log(message),
    run: async (trigger) => {
      const started = Date.now();
      try {
        const result = await runFullSync({ dryRun: false, trigger, log: (m) => console.log(m) });
        const jobsRows = (result.jobs as { appointmentRows?: number }).appointmentRows ?? 0;
        const eventsRows = (result.events as { rows?: number; error?: string }).rows;
        console.log(`[auto-sync] ok in ${((Date.now() - started) / 1000).toFixed(1)}s (jobs ${jobsRows} rows, events ${eventsRows ?? "FAILED"})`);
      } catch (err) {
        if (err instanceof SyncBusyError) {
          console.log("[auto-sync] another refresh is running; skipped this time");
          return;
        }
        const { category, detail } = describeSyncError(err);
        console.error(`[auto-sync] ${category}: ${detail}`);
        throw err;
      }
    },
  });
  g.__tgdgAutoSync = controller;
  controller.start();
}

export function getAutoSyncState(): AutoSyncState | null {
  return g.__tgdgAutoSync?.getState() ?? null;
}

/** What the status screen needs to know about the timer; null when there is none. */
export function getAutoSyncInfo(): AutoSyncInfo | null {
  const state = getAutoSyncState();
  if (!state || !state.enabled) return null;
  return { enabled: true, everyMinutes: state.everyMinutes, paused: state.paused, resumesAt: state.resumesAt, nextRunAt: state.nextRunAt };
}

export const autoSyncOffReason = () => g.__tgdgAutoSyncOff ?? null;
