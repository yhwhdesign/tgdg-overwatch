// @ts-nocheck
import { generateDispatchAvailability, generateDayAvailability, selectableRange, syncWindow, VIEW_DAYS, SELECTABLE_DAYS_AHEAD } from "../../src/lib/availability.ts";

const CT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23",
});
const fmt = (d: Date) => CT.format(d);
const results: string[] = [];
const log = (s: string) => results.push(s);
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  <- " + detail}`);
};

// 1. Monday 10:00 AM Little Rock (CDT = UTC-5), no appointments.
{
  const a = generateDispatchAvailability(new Date("2026-10-05T15:00:00Z"), []);
  check("tz reported", a.timeZone === "America/Chicago");
  check("today first slot is 10:00 CT", fmt(a.today.slots[0].start).endsWith("10:00"), fmt(a.today.slots[0].start));
  check("today last slot starts 5:00 PM CT", fmt(a.today.slots.at(-1)!.start).endsWith("17:00"), fmt(a.today.slots.at(-1)!.start));
  check("today slot count (10:00..17:00 every 30m = 15)", a.today.slots.length === 15, String(a.today.slots.length));
  check("tomorrow first slot is 8:00 CT", fmt(a.tomorrow.slots[0].start).endsWith("8:00"), fmt(a.tomorrow.slots[0].start));
  check("later day 3 is Oct 7", a.later.days[0].date === "2026-10-07", a.later.days[0].date);
}

// 2. After close (6:30 PM CT): same-day cutoff passed, tomorrow still opens at 8 AM CT.
{
  const a = generateDispatchAvailability(new Date("2026-10-05T23:30:00Z"), []);
  check("after close: cutoffPassed", a.today.cutoffPassed === true);
  check("after close: no same-day slots", a.today.slots.length === 0);
  check("after close: tomorrow opens 8:00 CT", fmt(a.tomorrow.slots[0].start).endsWith("8:00"));
}

// 3. Server clock says Oct 5 UTC, but it is still Oct 4 9 PM in Little Rock.
{
  const a = generateDispatchAvailability(new Date("2026-10-05T02:00:00Z"), []);
  check("late evening CT: 'today' is Oct 4 (closed)", a.today.cutoffPassed === true);
  check("late evening CT: tomorrow slots are Oct 5 at 8:00 CT", fmt(a.tomorrow.slots[0].start).startsWith("10/5") && fmt(a.tomorrow.slots[0].start).endsWith("8:00"), fmt(a.tomorrow.slots[0].start));
  check("late evening CT: later day 3 is Oct 6", a.later.days[0].date === "2026-10-06", a.later.days[0].date);
}

// 4. A busy block 9-10 AM CT tomorrow removes the overlapping slots only.
{
  const busy = [{ start: new Date("2026-10-06T14:00:00Z"), end: new Date("2026-10-06T15:00:00Z") }]; // 9-10 AM CDT
  const a = generateDispatchAvailability(new Date("2026-10-05T15:00:00Z"), busy);
  const starts = a.tomorrow.slots.map((s) => fmt(s.start).split(", ")[1] ?? fmt(s.start));
  check("busy 9-10: 8:00 slot still ok (ends 9:00)", starts.includes("08:00"), starts.join(" "));
  check("busy 9-10: 8:30 slot removed (overlaps)", !starts.includes("08:30"), starts.join(" "));
  check("busy 9-10: 9:00 slot removed (inside block)", !starts.includes("09:00"), starts.join(" "));
  check("busy 9-10: 9:30 removed", !starts.includes("09:30"));
  check("busy 9-10: 10:00 slot allowed", starts.includes("10:00"), starts.join(" "));
}

// 5. DST: clocks fall back Sun Nov 1 2026. 8 AM CT must stay 8 AM CT on both sides.
for (const [label, now, expectIso] of [
  ["Fri Oct 30 (CDT)", "2026-10-29T15:00:00Z", "2026-10-30T13:00:00.000Z"],
  ["Sun Nov 1 (CST, change day)", "2026-10-31T15:00:00Z", "2026-11-01T14:00:00.000Z"],
  ["Mon Nov 2 (CST)", "2026-11-01T15:00:00Z", "2026-11-02T14:00:00.000Z"],
] as const) {
  const a = generateDispatchAvailability(new Date(now), []);
  check(`DST ${label}: tomorrow 8:00 CT = ${expectIso}`, a.tomorrow.slots[0].start.toISOString() === expectIso, a.tomorrow.slots[0].start.toISOString());
}

// 6. Fully booked next 10 days: the default view must NOT reach further on its own.
{
  const busy = [{ start: new Date("2026-10-05T00:00:00Z"), end: new Date("2026-10-15T23:59:00Z") }];
  const a = generateDispatchAvailability(new Date("2026-10-05T15:00:00Z"), busy);
  check("fixed view: endDay stays 7 even when everything is full", a.later.endDay === 7 && VIEW_DAYS === 7, String(a.later.endDay));
  check("fixed view: days 3..7 = 5 entries, all empty", a.later.days.length === 5 && a.later.days.every((d) => d.slots.length === 0), String(a.later.days.length));
  check("fixed view: last day shown is Oct 11 (day 7)", a.later.days.at(-1)!.date === "2026-10-11", a.later.days.at(-1)!.date);
}

// 7. selectable range + sync window (forward-looking only)
{
  const NOWX = new Date("2026-10-05T15:00:00Z"); // Mon 10:00 CDT
  const r = selectableRange(NOWX);
  check("selectable: starts today", r.min === "2026-10-05", r.min);
  check("selectable: ends 30 days ahead", SELECTABLE_DAYS_AHEAD === 30 && r.max === "2026-11-04", r.max);
  const late = selectableRange(new Date("2026-10-05T02:00:00Z")); // still Oct 4 in Little Rock
  check("selectable: uses the business date, not the server's", late.min === "2026-10-04", late.min);
  const w = syncWindow(NOWX);
  check("syncWindow starts at midnight today CT (never yesterday)", w.from.toISOString() === "2026-10-05T05:00:00.000Z", w.from.toISOString());
  check("syncWindow ends at the end of the last selectable day (midnight, CST after the Nov 1 clock change)", w.to.toISOString() === "2026-11-05T06:00:00.000Z", w.to.toISOString());
  const early = syncWindow(new Date("2026-10-05T05:30:00Z")); // 12:30 AM Mon CT
  check("syncWindow right after midnight CT still starts today", early.from.toISOString() === "2026-10-05T05:00:00.000Z", early.from.toISOString());
  const before = syncWindow(new Date("2026-10-05T04:30:00Z")); // 11:30 PM Sun CT
  check("syncWindow just before midnight CT starts on Sunday", before.from.toISOString() === "2026-10-04T05:00:00.000Z", before.from.toISOString());
}

// 8. a specific day, on request
{
  const NOWX = new Date("2026-10-05T15:00:00Z");
  const far = generateDayAvailability(NOWX, [], "2026-10-20");
  check("day: first slot 8:00 CT", fmt(far.slots[0].start).endsWith("08:00"), fmt(far.slots[0].start));
  check("day: last slot starts 5:00 PM CT", fmt(far.slots.at(-1)!.start).endsWith("17:00"), fmt(far.slots.at(-1)!.start));
  check("day: 19 slots across a full day", far.slots.length === 19, String(far.slots.length));
  check("day: a future day is never 'cutoffPassed'", far.cutoffPassed === false);
  const today = generateDayAvailability(NOWX, [], "2026-10-05");
  check("day: today starts from now (10:00 CT)", fmt(today.slots[0].start).endsWith("10:00"), fmt(today.slots[0].start));
  const afterClose = generateDayAvailability(new Date("2026-10-05T23:30:00Z"), [], "2026-10-05");
  check("day: today after close is empty + cutoffPassed", afterClose.slots.length === 0 && afterClose.cutoffPassed === true);
  const busy = [{ start: new Date("2026-10-20T14:00:00Z"), end: new Date("2026-10-20T16:00:00Z") }]; // 9-11 AM CDT
  const withBusy = generateDayAvailability(NOWX, busy, "2026-10-20").slots.map((x) => fmt(x.start).split(", ")[1] ?? fmt(x.start));
  check("day: a 2-hour HCP block (9-11) removes overlapping starts", !withBusy.includes("08:30") && !withBusy.includes("09:00") && !withBusy.includes("10:30") && withBusy.includes("08:00") && withBusy.includes("11:00"), withBusy.join(" "));
  check("day: past date -> empty", generateDayAvailability(NOWX, [], "2026-10-01").slots.length === 0);
  const dst = generateDayAvailability(new Date("2026-10-05T15:00:00Z"), [], "2026-11-01");
  check("day: DST change day still opens 8:00 CST (14:00Z)", dst.slots[0].start.toISOString() === "2026-11-01T14:00:00.000Z", dst.slots[0].start.toISOString());
  let t1 = "", t2 = "";
  try { generateDayAvailability(NOWX, [], "10/20/2026"); } catch (e) { t1 = (e as Error).message; }
  try { generateDayAvailability(NOWX, [], "2026-02-31"); } catch (e) { t2 = (e as Error).message; }
  check("day: rejects a malformed date", /YYYY-MM-DD/.test(t1), t1);
  check("day: rejects an impossible date", /real calendar date/.test(t2), t2);
  const view = generateDispatchAvailability(NOWX, busy);
  const d3 = view.later.days.find((d) => d.date === "2026-10-07")!;
  const solo = generateDayAvailability(NOWX, busy, "2026-10-07");
  check("day: matches the default view for the same date", JSON.stringify(d3.slots) === JSON.stringify(solo.slots));
}

console.log(`TZ=${process.env.TZ}`);
console.log(results.join("\n"));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
// machine-readable fingerprint so we can compare outputs across server time zones
const fp = generateDispatchAvailability(new Date("2026-10-05T15:00:00Z"), []);
console.log("FINGERPRINT", JSON.stringify(fp));
process.exit(failures === 0 ? 0 : 1);
