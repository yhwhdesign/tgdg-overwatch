import { createAutoSync, readAutoSyncConfig, isWithinHours, formatHour, type AutoSyncConfig } from "../../src/lib/auto-sync-controller.ts";
let passes = 0, failures = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

// ================= A. configuration =================
{
  const d = readAutoSyncConfig({});
  eq("A1 defaults: on, every 10 minutes, 6 AM to 7 PM, Chicago, nothing to warn about", [d.enabled, d.everyMinutes, d.startHour, d.endHour, d.timeZone, d.warnings], [true, 10, 6, 19, "America/Chicago", []]);
  for (const off of ["0", "off", "OFF", "false", "no"]) check(`A2 AUTO_SYNC_MINUTES=${off} switches it off`, readAutoSyncConfig({ AUTO_SYNC_MINUTES: off }).enabled === false && readAutoSyncConfig({ AUTO_SYNC_MINUTES: off }).reason !== null);
  const fast = readAutoSyncConfig({ AUTO_SYNC_MINUTES: "1" });
  check("A3 a setting below 5 minutes is raised to 5 (it would keep the free database awake all day) and says so", fast.everyMinutes === 5 && fast.warnings.some((w) => /below 5/.test(w)), JSON.stringify(fast));
  eq("A4 15 minutes is respected", readAutoSyncConfig({ AUTO_SYNC_MINUTES: "15" }).everyMinutes, 15);
  eq("A5 the test-only escape hatch allows very fast refreshes", readAutoSyncConfig({ AUTO_SYNC_MINUTES: "0.05", AUTO_SYNC_ALLOW_FAST: "1" }).everyMinutes, 0.05);
  const junk = readAutoSyncConfig({ AUTO_SYNC_MINUTES: "banana" });
  check("A6 nonsense falls back to 10 with a warning", junk.everyMinutes === 10 && junk.enabled && junk.warnings.length === 1, JSON.stringify(junk));
  eq("A7 hours can be set", [readAutoSyncConfig({ AUTO_SYNC_HOURS: "7-18" }).startHour, readAutoSyncConfig({ AUTO_SYNC_HOURS: "7-18" }).endHour], [7, 18]);
  eq("A7 0-24 means around the clock", [readAutoSyncConfig({ AUTO_SYNC_HOURS: "0-24" }).startHour, readAutoSyncConfig({ AUTO_SYNC_HOURS: "0-24" }).endHour], [0, 24]);
  for (const bad of ["19-6", "6-6", "6-25", "six-nineteen", "6"]) {
    const c = readAutoSyncConfig({ AUTO_SYNC_HOURS: bad });
    check(`A8 hours "${bad}" is refused with a warning and the default is kept`, c.startHour === 6 && c.endHour === 19 && c.warnings.length === 1, JSON.stringify(c.warnings));
  }
  const tz = readAutoSyncConfig({ BUSINESS_TIMEZONE: "Not/AZone" });
  check("A9 a bad time zone falls back to Chicago with a warning", tz.timeZone === "America/Chicago" && tz.warnings.length === 1);
  eq("A10 a good time zone is respected", readAutoSyncConfig({ BUSINESS_TIMEZONE: "America/New_York" }).timeZone, "America/New_York");
  eq("A11 startup delay: default 5 s, configurable, junk ignored", [readAutoSyncConfig({}).startupDelayMs, readAutoSyncConfig({ AUTO_SYNC_STARTUP_DELAY_SECONDS: "2" }).startupDelayMs, readAutoSyncConfig({ AUTO_SYNC_STARTUP_DELAY_SECONDS: "x" }).startupDelayMs], [5000, 2000, 5000]);
  eq("A12 hours read as clock text", [formatHour(6), formatHour(12), formatHour(19), formatHour(0), formatHour(24)], ["6:00 AM", "12:00 PM", "7:00 PM", "12:00 AM", "12:00 AM"]);
}

// ================= B. business hours, by the wall clock in the business time zone =================
{
  const cfg = { startHour: 6, endHour: 19, timeZone: "America/Chicago" };
  const at = (iso: string) => isWithinHours(new Date(iso), cfg);
  check("B1 5:59 AM Chicago is outside, 6:00 AM is inside", !at("2026-10-12T10:59:00Z") && at("2026-10-12T11:00:00Z"));
  check("B2 6:59 PM is inside, 7:00 PM is outside (the end hour is exclusive)", at("2026-10-12T23:59:00Z") && !at("2026-10-13T00:00:00Z"));
  check("B3 after the clocks change (CST, UTC-6) the same wall-clock hours hold: 6:00 AM is 12:00Z", !at("2026-11-02T11:59:00Z") && at("2026-11-02T12:00:00Z"));
  check("B4 0-24 is always inside", isWithinHours(new Date("2026-10-12T03:00:00Z"), { startHour: 0, endHour: 24, timeZone: "America/Chicago" }));
}

// ================= C. the controller with a fake clock =================
function world(startIso: string, over: Partial<AutoSyncConfig> = {}, runImpl?: (trigger: string, n: number) => Promise<void>) {
  let t = new Date(startIso).getTime();
  const timers: { id: number; at: number; fn: () => void | Promise<void> }[] = [];
  let nextId = 1;
  const logs: string[] = [];
  const runs: { trigger: string; at: string }[] = [];
  const config: AutoSyncConfig = { ...readAutoSyncConfig({}), ...over };
  const controller = createAutoSync({
    config,
    now: () => new Date(t),
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ id, at: t + ms, fn }); return id; },
    clearTimer: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
    run: async (trigger) => { runs.push({ trigger, at: new Date(t).toISOString() }); if (runImpl) await runImpl(trigger, runs.length); },
    log: (m) => logs.push(m),
  });
  const advance = async (ms: number) => {
    const target = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > target) break;
      timers.shift(); t = Math.max(t, next.at); await next.fn();
    }
    t = target;
  };
  return { controller, timers, logs, runs, advance, config, clock: () => new Date(t) };
}
const MIN = 60_000;
{
  const w = world("2026-10-12T16:00:00Z");                      // 11:00 AM Chicago: inside hours
  check("C1 nothing runs before start()", w.runs.length === 0 && w.controller.getState().enabled === false);
  w.controller.start();
  await w.advance(4_000);
  eq("C2 nothing runs during the 5 second startup delay", w.runs.length, 0);
  await w.advance(2_000);
  eq("C3 then one 'startup' run", w.runs.map((r) => r.trigger), ["startup"]);
  await w.advance(10 * MIN);
  await w.advance(10 * MIN);
  eq("C4 then an 'auto' run every 10 minutes", w.runs.map((r) => r.trigger), ["startup", "auto", "auto"]);
  const gaps = w.runs.slice(1).map((r, i) => (Date.parse(r.at) - Date.parse(w.runs[i].at)) / MIN);
  eq("C4 ...exactly 10 minutes apart", gaps, [10, 10]);
  w.controller.start();
  await w.advance(1);
  check("C5 calling start() again does not create a second timer chain", w.timers.length === 1 && w.runs.length === 3);
  const s = w.controller.getState();
  check("C6 the state reports enabled, not paused, the interval, the next run time and the last trigger", s.enabled && !s.paused && s.everyMinutes === 10 && s.lastTrigger === "auto" && s.nextRunAt !== null && s.consecutiveFailures === 0, JSON.stringify(s));
  w.controller.stop();
  await w.advance(60 * MIN);
  check("C7 stop() ends it: no more runs, no pending timers, and the state says disabled", w.runs.length === 3 && w.timers.length === 0 && w.controller.getState().enabled === false);
}
{
  // outside hours at startup: 5:00 AM Chicago
  const w = world("2026-10-12T10:00:00Z");
  w.controller.start();
  await w.advance(30 * MIN);
  eq("C8 before 6 AM nothing runs, and it says it is paused (once, not every check)", [w.runs.length, w.logs.filter((l) => /paused/.test(l)).length], [0, 1]);
  const paused = w.controller.getState();
  check("C8 the state says paused and when it resumes", paused.paused && paused.resumesAt === "6:00 AM", JSON.stringify(paused));
  await w.advance(40 * MIN);       // now 5:00:00 + 70 min = 6:10 AM
  check("C9 once the hours begin the first run happens at the next check, and it is an 'auto' run", w.runs.length === 1 && w.runs[0].trigger === "auto" && w.runs[0].at === "2026-10-12T11:00:05.000Z", JSON.stringify(w.runs));
  await w.advance(14 * 60 * MIN);   // past 7 PM
  const afterClose = w.runs.length;
  await w.advance(6 * 60 * MIN);
  check("C10 after 7 PM it stops running again (the free database may sleep all night)", w.runs.length === afterClose && w.runs.every((r) => { const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date(r.at))); return h >= 6 && h < 19; }), JSON.stringify(w.runs.map((r) => r.at)));
}
{
  // failures back off, and a success resets
  let failNow = true;
  const w = world("2026-10-12T16:00:00Z", {}, async () => { if (failNow) throw new Error("Can't reach database server"); });
  w.controller.start();
  await w.advance(5_000);
  eq("C11 a failing run is recorded and the loop survives", [w.runs.length, w.controller.getState().consecutiveFailures], [1, 1]);
  await w.advance(10 * MIN);
  await w.advance(20 * MIN);
  await w.advance(30 * MIN);
  await w.advance(30 * MIN);
  const gaps = w.runs.slice(1).map((r, i) => (Date.parse(r.at) - Date.parse(w.runs[i].at)) / MIN);
  eq("C12 retries slow down while it keeps failing: 10, 20, 30, then never more than 30 minutes", gaps, [10, 20, 30, 30]);
  check("C13 the log says what is happening, without any error text from the failure", w.logs.some((l) => /refresh failed \(attempt 2\); next try in 30 min/.test(l)) || w.logs.some((l) => /refresh failed/.test(l)), w.logs.join(" | "));
  check("C13 ...and never repeats the failure's own message (it may carry a host name)", !w.logs.some((l) => /Can't reach|neon/i.test(l)));
  failNow = false;
  await w.advance(30 * MIN);
  const state = w.controller.getState();
  check("C14 one success resets everything and it recovers on the normal 10 minute rhythm", state.consecutiveFailures === 0 && w.logs.some((l) => /recovered after 5 failed attempts/.test(l)), w.logs.join(" | "));
  await w.advance(10 * MIN);
  const last = w.runs.slice(-2).map((r) => Date.parse(r.at));
  eq("C14 ...the gap after recovery is back to 10 minutes", (last[1] - last[0]) / MIN, 10);
}
{
  // a run that throws synchronously, and a run that is still going when another tick fires
  const w1 = world("2026-10-12T16:00:00Z", {}, () => { throw new Error("sync boom"); });
  w1.controller.start();
  await w1.advance(5_000);
  check("C15 a run that throws synchronously cannot kill the loop", w1.controller.getState().consecutiveFailures === 1 && w1.timers.length === 1);

  let release: () => void = () => {};
  const w2 = world("2026-10-12T16:00:00Z", {}, () => new Promise<void>((resolve) => { release = resolve; }));
  w2.controller.start();
  const first = w2.timers[0].fn;
  const p1 = first();                          // starts a run that does not finish yet
  const p2 = first();                          // a second tick arrives while it is still running
  await p2;
  check("C16 a tick that arrives while a run is still going does not start a second run", w2.runs.length === 1 && w2.controller.getState().running);
  release(); await p1;
  check("C16 when the run finishes the state is not running", !w2.controller.getState().running);
}
{
  // disabled
  const w = world("2026-10-12T16:00:00Z", { enabled: false, reason: "AUTO_SYNC_MINUTES is off" });
  w.controller.start();
  await w.advance(60 * MIN);
  check("C17 when disabled, start() does nothing at all", w.runs.length === 0 && w.timers.length === 0 && !w.controller.getState().enabled);
  // stop during a run
  let release: () => void = () => {};
  const w3 = world("2026-10-12T16:00:00Z", {}, () => new Promise<void>((resolve) => { release = resolve; }));
  w3.controller.start();
  const fired = w3.timers.shift()!;             // a real clock removes a timer when it fires
  const p = fired.fn();
  w3.controller.stop();
  release(); await p;
  check("C18 stopping during a run lets it finish but schedules nothing afterwards", w3.timers.length === 0);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
