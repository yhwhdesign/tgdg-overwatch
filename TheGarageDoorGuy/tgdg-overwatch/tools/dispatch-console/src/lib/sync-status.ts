// How fresh is the schedule data, and is refreshing working? Pure logic plus two small database helpers.
// This module has no runtime imports, like hcp-sync.ts: everything it needs is passed in.

export type SyncPart = "jobs" | "events";

export interface SyncStatusRow {
  key: string;
  lastAttemptAt: Date;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastErrorDetail: string | null;
  lastTrigger: string | null;
  lastDurationMs: number | null;
}

/** The slice of the database this module needs. */
export interface StatusDb {
  syncStatus: {
    upsert(args: Record<string, unknown>): Promise<unknown>;
    findMany(args?: Record<string, unknown>): Promise<SyncStatusRow[]>;
  };
}

// ---- errors: a short safe category for everyone, the detail for admins only ---------------------

export interface DescribedError {
  /** Safe to show to any console user: never a host name, key or customer detail. */
  category: string;
  /** Truncated detail for the Admin screen and the server log. */
  detail: string;
}

export function describeSyncError(err: unknown): DescribedError {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const code = (err as { code?: unknown } | null)?.code;
  const detail = raw.replace(/\s+/g, " ").slice(0, 300);
  let category = "an unexpected error (see the server log)";
  if (code === "P1001" || code === "P1002" || /Can't reach database server|P1001|P1002/i.test(raw)) {
    category = "the database could not be reached";
  } else if (/rejected the API key|HTTP 40[13]\b|error 40[13]\b/i.test(raw)) {
    category = "Housecall Pro rejected the key";
  } else if (/\b429\b|rate.?limit/i.test(raw)) {
    category = "Housecall Pro is limiting how often we can ask";
  } else if (/took longer than/i.test(raw)) {
    category = "reading Housecall Pro took too long";
  } else if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(raw)) {
    category = "Housecall Pro could not be reached (check the internet connection)";
  } else if (/error 5\d\d\b|HTTP 5\d\d\b/i.test(raw)) {
    category = "Housecall Pro had a problem on its side";
  }
  return { category, detail };
}

// ---- recording ---------------------------------------------------------------------------------

export interface PartOutcome {
  part: SyncPart;
  ok: boolean;
  startedAt: Date;
  finishedAt: Date;
  trigger: string;
  error?: unknown;
}

/** Records what just happened for one part. A failure never erases the time of the last success. */
export async function recordPartOutcome(db: StatusDb, outcome: PartOutcome): Promise<void> {
  const durationMs = Math.max(0, outcome.finishedAt.getTime() - outcome.startedAt.getTime());
  if (outcome.ok) {
    const data = { lastAttemptAt: outcome.finishedAt, lastSuccessAt: outcome.finishedAt, lastError: null, lastErrorDetail: null, lastTrigger: outcome.trigger, lastDurationMs: durationMs };
    await db.syncStatus.upsert({ where: { key: outcome.part }, update: data, create: { key: outcome.part, ...data } });
    return;
  }
  const { category, detail } = describeSyncError(outcome.error);
  const data = { lastAttemptAt: outcome.finishedAt, lastError: category, lastErrorDetail: detail, lastTrigger: outcome.trigger, lastDurationMs: durationMs };
  await db.syncStatus.upsert({ where: { key: outcome.part }, update: data, create: { key: outcome.part, lastSuccessAt: null, ...data } });
}

export async function loadSyncStatus(db: StatusDb): Promise<SyncStatusRow[]> {
  return db.syncStatus.findMany();
}

// ---- freshness ---------------------------------------------------------------------------------

export type FreshnessState = "ok" | "stale" | "failing" | "paused" | "unknown";

export interface AutoSyncInfo {
  enabled: boolean;
  everyMinutes: number | null;
  /** Outside the hours when automatic refresh runs. */
  paused: boolean;
  /** Local text like "6:00 AM", for the "paused until" message. */
  resumesAt: string | null;
  nextRunAt: Date | null;
}

export interface PartFreshness {
  part: SyncPart;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  ageMinutes: number | null;
  state: "ok" | "stale" | "failing" | "unknown";
  error: string | null;
}

export interface FreshnessReport {
  state: FreshnessState;
  /** The OLDEST successful refresh across the parts: the schedule is only as fresh as its stalest part. */
  asOf: string | null;
  /** The same moment as clock text in the business time zone, like "3:26 PM". */
  asOfText: string | null;
  timeZone: string;
  ageMinutes: number | null;
  staleAfterMinutes: number;
  message: string;
  parts: PartFreshness[];
  autoSync: { enabled: boolean; everyMinutes: number | null; paused: boolean; nextRunAt: string | null };
}

const PARTS: SyncPart[] = ["jobs", "events"];
const SEVERITY: Record<PartFreshness["state"], number> = { ok: 0, unknown: 1, stale: 2, failing: 3 };

/** How old data may get before we say so: twice the refresh interval plus slack, or 30 minutes if nothing refreshes it automatically. */
export function staleAfterMinutes(auto: AutoSyncInfo | null, override?: number | null): number {
  if (override && override > 0) return override;
  if (auto?.enabled && auto.everyMinutes) return Math.max(15, auto.everyMinutes * 2 + 2);
  return 30;
}

function agoText(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr ago` : `${hours} hr ${rest} min ago`;
}

export function computeFreshness(input: {
  rows: SyncStatusRow[];
  now: Date;
  timeZone: string;
  auto: AutoSyncInfo | null;
  staleAfterOverrideMinutes?: number | null;
}): FreshnessReport {
  const { rows, now, timeZone, auto } = input;
  const limit = staleAfterMinutes(auto, input.staleAfterOverrideMinutes);
  const clock = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });

  const parts: PartFreshness[] = PARTS.map((part) => {
    const row = rows.find((r) => r.key === part);
    if (!row || !row.lastSuccessAt) {
      return { part, lastSuccessAt: null, lastAttemptAt: row?.lastAttemptAt?.toISOString() ?? null, ageMinutes: null, state: "unknown", error: row?.lastError ?? null };
    }
    const ageMinutes = Math.max(0, Math.floor((now.getTime() - row.lastSuccessAt.getTime()) / 60000));
    const lastAttemptFailed = row.lastError !== null && row.lastAttemptAt.getTime() > row.lastSuccessAt.getTime();
    let state: PartFreshness["state"] = "ok";
    if (ageMinutes > limit) state = lastAttemptFailed ? "failing" : "stale";
    else if (lastAttemptFailed && auto?.enabled && auto.everyMinutes && ageMinutes > auto.everyMinutes * 1.5) state = "failing";
    return { part, lastSuccessAt: row.lastSuccessAt.toISOString(), lastAttemptAt: row.lastAttemptAt.toISOString(), ageMinutes, state, error: lastAttemptFailed ? row.lastError : null };
  });

  const known = parts.filter((p) => p.lastSuccessAt);
  const oldest = known.length === parts.length ? known.reduce((a, b) => (new Date(a.lastSuccessAt!) <= new Date(b.lastSuccessAt!) ? a : b)) : null;
  const worst = parts.reduce((a, b) => (SEVERITY[b.state] > SEVERITY[a.state] ? b : a));
  const asOfIso = oldest?.lastSuccessAt ?? null;
  const ageMinutes = oldest?.ageMinutes ?? null;
  const asOfText = asOfIso ? clock.format(new Date(asOfIso)) : null;
  const autoOut = { enabled: !!auto?.enabled, everyMinutes: auto?.everyMinutes ?? null, paused: !!auto?.paused, nextRunAt: auto?.nextRunAt?.toISOString() ?? null };

  let state: FreshnessState;
  let message: string;
  if (worst.state === "unknown") {
    state = "unknown";
    message = known.length === 0 ? "No schedule update has been recorded yet." : `The ${worst.part} part of the schedule has never been recorded as updated.`;
  } else if (auto?.enabled && auto.paused) {
    state = "paused";
    message = `Automatic updates are paused${auto.resumesAt ? ` until ${auto.resumesAt}` : ""}. Showing the schedule as of ${asOfText}.`;
  } else if (worst.state === "failing") {
    state = "failing";
    message = `Updates are failing (${worst.error ?? "unknown reason"}). Showing the schedule as of ${asOfText}.`;
  } else if (worst.state === "stale") {
    state = "stale";
    message = `The schedule is ${ageMinutes} minutes old. Updates may be stuck. Showing it as of ${asOfText}.`;
  } else {
    state = "ok";
    message = `Schedule as of ${asOfText} (${agoText(ageMinutes ?? 0)}).`;
  }
  return { state, asOf: asOfIso, asOfText, timeZone, ageMinutes, staleAfterMinutes: limit, message, parts, autoSync: autoOut };
}
