// The automatic refresh timer, with its clock and timers passed in so it can be tested without waiting.
// Good-citizen rules (the database is on Neon's free plan, which sleeps after 5 idle minutes and has a
// monthly compute allowance): refresh only during business hours, never more often than every 5 minutes,
// never two runs at once, and back off when something is failing instead of hammering it.
// This module has no runtime imports.

export interface AutoSyncConfig {
  enabled: boolean;
  /** Why it is off, when it is. */
  reason: string | null;
  everyMinutes: number;
  /** Business hours in `timeZone`: runs from startHour up to (not including) endHour. */
  startHour: number;
  endHour: number;
  timeZone: string;
  startupDelayMs: number;
  warnings: string[];
}

const DEFAULT_MINUTES = 10;
const MIN_MINUTES = 5;
const FAST_TEST_MIN_MINUTES = 0.05;
const MAX_BACKOFF_MS = 30 * 60_000;

function validTimeZone(candidate: string | undefined): string | null {
  if (!candidate) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return null;
  }
}

export function formatHour(hour: number): string {
  const h = hour % 24;
  if (h === 0) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  return `${h % 12}:00 ${h < 12 ? "AM" : "PM"}`;
}

export function readAutoSyncConfig(env: Record<string, string | undefined>): AutoSyncConfig {
  const warnings: string[] = [];
  const raw = (env.AUTO_SYNC_MINUTES ?? String(DEFAULT_MINUTES)).trim().toLowerCase();
  const timeZone = validTimeZone(env.BUSINESS_TIMEZONE) ?? "America/Chicago";
  if (env.BUSINESS_TIMEZONE && !validTimeZone(env.BUSINESS_TIMEZONE)) warnings.push(`BUSINESS_TIMEZONE "${env.BUSINESS_TIMEZONE}" is not a time zone; using America/Chicago`);

  let startHour = 6;
  let endHour = 19;
  const hoursText = (env.AUTO_SYNC_HOURS ?? "").trim();
  if (hoursText) {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(hoursText);
    if (m && Number(m[1]) >= 0 && Number(m[1]) < Number(m[2]) && Number(m[2]) <= 24) {
      startHour = Number(m[1]);
      endHour = Number(m[2]);
    } else {
      warnings.push(`AUTO_SYNC_HOURS "${hoursText}" is not like 6-19; using 6-19`);
    }
  }

  const allowFast = env.AUTO_SYNC_ALLOW_FAST === "1";
  let everyMinutes = DEFAULT_MINUTES;
  let enabled = true;
  let reason: string | null = null;
  if (raw === "0" || raw === "off" || raw === "false" || raw === "no") {
    enabled = false;
    reason = "AUTO_SYNC_MINUTES is off";
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      warnings.push(`AUTO_SYNC_MINUTES "${raw}" is not a number; using ${DEFAULT_MINUTES}`);
    } else {
      const floor = allowFast ? FAST_TEST_MIN_MINUTES : MIN_MINUTES;
      everyMinutes = Math.max(n, floor);
      if (n < floor) warnings.push(`AUTO_SYNC_MINUTES ${n} is below ${MIN_MINUTES}, which would keep the free database awake all day; using ${floor}`);
    }
  }
  const delaySeconds = Number(env.AUTO_SYNC_STARTUP_DELAY_SECONDS ?? "5");
  const startupDelayMs = Number.isFinite(delaySeconds) && delaySeconds >= 0 ? delaySeconds * 1000 : 5000;
  return { enabled, reason, everyMinutes, startHour, endHour, timeZone, startupDelayMs, warnings };
}

/** Is this moment inside the refresh hours, by the wall clock in the business time zone? */
export function isWithinHours(at: Date, config: Pick<AutoSyncConfig, "startHour" | "endHour" | "timeZone">): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: config.timeZone, hour: "numeric", hourCycle: "h23" }).format(at));
  return hour >= config.startHour && hour < config.endHour;
}

export interface AutoSyncState {
  enabled: boolean;
  running: boolean;
  everyMinutes: number;
  /** Outside the refresh hours right now. */
  paused: boolean;
  resumesAt: string;
  /** For example "6:00 AM to 7:00 PM". */
  hoursText: string;
  nextRunAt: Date | null;
  lastTrigger: string | null;
  consecutiveFailures: number;
}

export interface AutoSyncDeps {
  config: AutoSyncConfig;
  now: () => Date;
  setTimer: (fn: () => void | Promise<void>, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  run: (trigger: "startup" | "auto") => Promise<void>;
  log: (message: string) => void;
}

export function createAutoSync(deps: AutoSyncDeps) {
  const { config } = deps;
  const base = config.everyMinutes * 60_000;
  let started = false;
  let stopped = false;
  let running = false;
  let handle: unknown = null;
  let nextRunAt: Date | null = null;
  let failures = 0;
  let lastTrigger: string | null = null;
  let announcedPause = false;

  const delayAfter = () => (failures <= 1 ? base : Math.min(base * failures, MAX_BACKOFF_MS));
  const schedule = (ms: number, trigger: "startup" | "auto") => {
    if (stopped) return;
    nextRunAt = new Date(deps.now().getTime() + ms);
    handle = deps.setTimer(() => tick(trigger), ms);
  };

  async function tick(trigger: "startup" | "auto"): Promise<void> {
    handle = null;
    if (stopped) return;
    if (running) {
      // A previous run is still going: never start a second one.
      schedule(base, "auto");
      return;
    }
    if (!isWithinHours(deps.now(), config)) {
      if (!announcedPause) deps.log(`[auto-sync] outside refresh hours (${formatHour(config.startHour)} to ${formatHour(config.endHour)}); paused`);
      announcedPause = true;
      schedule(base, "auto");
      return;
    }
    announcedPause = false;
    running = true;
    lastTrigger = trigger;
    try {
      await deps.run(trigger);
      if (failures > 0) deps.log(`[auto-sync] recovered after ${failures} failed attempt${failures === 1 ? "" : "s"}`);
      failures = 0;
    } catch {
      failures += 1;
      deps.log(`[auto-sync] refresh failed (attempt ${failures}); next try in ${Math.round(delayAfter() / 60000)} min`);
    } finally {
      running = false;
    }
    schedule(delayAfter(), "auto");
  }

  return {
    start() {
      if (started || !config.enabled) return;
      started = true;
      deps.log(`[auto-sync] on: every ${config.everyMinutes} min, ${formatHour(config.startHour)} to ${formatHour(config.endHour)} (${config.timeZone})`);
      schedule(config.startupDelayMs, "startup");
    },
    stop() {
      stopped = true;
      if (handle !== null) deps.clearTimer(handle);
      handle = null;
      nextRunAt = null;
    },
    getState(): AutoSyncState {
      return {
        enabled: config.enabled && started && !stopped,
        running,
        everyMinutes: config.everyMinutes,
        paused: config.enabled && !isWithinHours(deps.now(), config),
        resumesAt: formatHour(config.startHour),
        hoursText: `${formatHour(config.startHour)} to ${formatHour(config.endHour)}`,
        nextRunAt,
        lastTrigger,
        consecutiveFailures: failures,
      };
    },
  };
}
