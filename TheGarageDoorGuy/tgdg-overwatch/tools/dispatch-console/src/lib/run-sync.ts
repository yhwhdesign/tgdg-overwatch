import { prisma } from "@/lib/prisma";
import { hcpApi } from "@/lib/hcp-client";
import { businessTimeZone, syncWindow } from "@/lib/availability";
import {
  retireDemoTechnician,
  syncEmployees,
  syncEventsWindow,
  syncJobsWindow,
  type Db,
  type EventsSyncReport,
  type HcpApi,
} from "@/lib/hcp-sync";
import { recordPartOutcome, type StatusDb } from "@/lib/sync-status";

// ONE way to refresh the schedule from Housecall Pro, used by every trigger: the manual script, the
// Admin "Refresh now" button, and the automatic timer. It records what happened (so the console can say
// how fresh the data is) and it never lets two refreshes run at the same time.

export type SyncTrigger = "manual" | "auto" | "startup";

export interface RunSyncOptions {
  dryRun: boolean;
  retireDemo?: boolean;
  trigger: SyncTrigger;
  log?: (message: string) => void;
}

export interface RunSyncDeps {
  db: Db & StatusDb;
  hcp: HcpApi;
  now: () => Date;
  window: (now: Date) => { from: Date; to: Date };
  timeZone: string;
}

export async function runSync(deps: RunSyncDeps, opts: RunSyncOptions) {
  const log = opts.log ?? (() => {});
  const { from, to } = deps.window(deps.now());
  const syncDeps = { db: deps.db, hcp: deps.hcp };
  let statusRecorded = true;
  const record = async (outcome: Parameters<typeof recordPartOutcome>[1]) => {
    if (opts.dryRun) return; // a dry run changes nothing, so it must not change how fresh the data looks
    try {
      await recordPartOutcome(deps.db, outcome);
    } catch (err) {
      statusRecorded = false;
      log(`[sync] could not record the sync status (has the database migration been run?): ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    }
  };

  const jobsStarted = deps.now();
  try {
    const { report: employees, employees: raw } = await syncEmployees(syncDeps, { dryRun: opts.dryRun });
    const jobs = await syncJobsWindow(syncDeps, { from, to, dryRun: opts.dryRun, employees: raw });
    await record({ part: "jobs", ok: true, startedAt: jobsStarted, finishedAt: deps.now(), trigger: opts.trigger });

    // Calendar events (errands, time off, meetings). A problem here must never undo the job sync.
    const eventsStarted = deps.now();
    let events: EventsSyncReport | { error: string };
    try {
      events = await syncEventsWindow(syncDeps, { from, to, dryRun: opts.dryRun, employees: raw, log, timeZone: deps.timeZone });
      await record({ part: "events", ok: true, startedAt: eventsStarted, finishedAt: deps.now(), trigger: opts.trigger });
    } catch (err) {
      events = { error: err instanceof Error ? err.message : String(err) };
      await record({ part: "events", ok: false, startedAt: eventsStarted, finishedAt: deps.now(), trigger: opts.trigger, error: err });
    }
    const retiredDemo = opts.retireDemo ? await retireDemoTechnician(deps.db, { dryRun: opts.dryRun }) : null;
    invalidateStatusCache();
    return { dryRun: opts.dryRun, employees, jobs, events, retiredDemo, statusRecorded };
  } catch (err) {
    await record({ part: "jobs", ok: false, startedAt: jobsStarted, finishedAt: deps.now(), trigger: opts.trigger, error: err });
    invalidateStatusCache();
    throw err;
  }
}

// ---- the lock: one refresh at a time, whatever started it -------------------------------------------

const g = globalThis as { __tgdgSyncRunning?: boolean; __tgdgStatusCache?: unknown };

export class SyncBusyError extends Error {
  code = "SYNC_BUSY" as const;
  constructor() {
    super("A refresh is already running.");
    this.name = "SyncBusyError";
  }
}

export const isSyncRunning = () => g.__tgdgSyncRunning === true;

/** Forget the cached status, so the next look at it reads the database. */
export function invalidateStatusCache() {
  g.__tgdgStatusCache = undefined;
}

export async function runFullSync(opts: RunSyncOptions) {
  if (g.__tgdgSyncRunning) throw new SyncBusyError();
  g.__tgdgSyncRunning = true;
  try {
    return await runSync(
      { db: prisma as unknown as Db & StatusDb, hcp: hcpApi, now: () => new Date(), window: syncWindow, timeZone: businessTimeZone() },
      opts
    );
  } finally {
    g.__tgdgSyncRunning = false;
  }
}
