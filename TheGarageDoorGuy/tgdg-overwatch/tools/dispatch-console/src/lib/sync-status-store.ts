import { prisma } from "@/lib/prisma";
import { businessTimeZone } from "@/lib/availability";
import { getAutoSyncInfo, getAutoSyncState, autoSyncOffReason } from "@/lib/auto-sync";
import { computeFreshness, loadSyncStatus, type FreshnessReport, type StatusDb, type SyncStatusRow } from "@/lib/sync-status";
import { isSyncRunning } from "@/lib/run-sync";

// Reads the refresh status for the screens. The public status is answered from memory when it can be:
// every look at the database wakes the sleeping free plan, and a console tab left open overnight would
// otherwise keep it awake all night.

const db = prisma as unknown as StatusDb;
const g = globalThis as { __tgdgStatusCache?: { rows: SyncStatusRow[]; at: number } };

const IN_HOURS_TTL_MS = 10 * 60_000;
const PAUSED_TTL_MS = 60 * 60_000;

function staleOverride(): number | null {
  const n = Number(process.env.STALE_AFTER_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function rows(useCache: boolean, ttlMs: number): Promise<SyncStatusRow[]> {
  const cached = g.__tgdgStatusCache;
  if (useCache && cached && Date.now() - cached.at < ttlMs) return cached.rows;
  const fresh = await loadSyncStatus(db);
  g.__tgdgStatusCache = { rows: fresh, at: Date.now() };
  return fresh;
}

/** What any console user may see: times, a state, a short safe message. */
export async function getFreshness(): Promise<FreshnessReport> {
  const auto = getAutoSyncInfo();
  const loaded = await rows(true, auto?.paused ? PAUSED_TTL_MS : IN_HOURS_TTL_MS);
  return computeFreshness({ rows: loaded, now: new Date(), timeZone: businessTimeZone(), auto, staleAfterOverrideMinutes: staleOverride() });
}

/** The fuller picture for the Admin screen: always read fresh, includes the error detail and the timer's state. */
export async function getAdminStatus() {
  const loaded = await rows(false, 0);
  const auto = getAutoSyncInfo();
  const report = computeFreshness({ rows: loaded, now: new Date(), timeZone: businessTimeZone(), auto, staleAfterOverrideMinutes: staleOverride() });
  const state = getAutoSyncState();
  return {
    ...report,
    refreshRunning: isSyncRunning(),
    timer: state
      ? { running: state.running, consecutiveFailures: state.consecutiveFailures, lastTrigger: state.lastTrigger, resumesAt: state.resumesAt, hoursText: state.hoursText }
      : null,
    timerOffReason: state ? null : autoSyncOffReason() ?? "the server has not started it",
    details: loaded.map((r) => ({
      part: r.key,
      lastAttemptAt: r.lastAttemptAt.toISOString(),
      lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
      lastError: r.lastError,
      lastErrorDetail: r.lastErrorDetail,
      lastTrigger: r.lastTrigger,
      lastDurationMs: r.lastDurationMs,
    })),
  };
}
