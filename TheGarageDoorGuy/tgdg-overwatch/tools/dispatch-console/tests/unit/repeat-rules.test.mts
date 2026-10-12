import { parseRepeatRule, expandRepeat, eventToOccurrences, EVENTS_LOOKBACK_DAYS } from "../../src/lib/hcp-sync.ts";
let passes = 0, failures = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const expand = (ruleText: string, startIso: string, durMin: number, tz: string, fromIso: string, toIso: string) => {
  const p = parseRepeatRule(ruleText);
  if ("unsupported" in p) throw new Error("unexpected unsupported: " + p.unsupported);
  return expandRepeat(p.rule, new Date(startIso), durMin * 60000, tz, { from: new Date(fromIso), to: new Date(toIso) }).map((d) => d.toISOString());
};
const days = (list: string[]) => list.map((s) => s.slice(0, 10));

// ================= A. the real event, and daylight saving =================
{
  const real = expand("FREQ=WEEKLY;INTERVAL=1;WKST=SU;BYDAY=MO", "2026-10-12T13:00:00Z", 30, "America/Chicago", "2026-10-08T05:00:00Z", "2026-11-08T06:00:00Z");
  eq("A1 the real weekly-Monday event: 4 occurrences in the window, and Nov 2 is 14:00Z because the clocks changed on Nov 1 (8:00 AM stays 8:00 AM)", real, ["2026-10-12T13:00:00.000Z", "2026-10-19T13:00:00.000Z", "2026-10-26T13:00:00.000Z", "2026-11-02T14:00:00.000Z"]);
  eq("A2 spring forward: Mondays at 8:00 AM Chicago across Mar 14 2027", expand("FREQ=WEEKLY;BYDAY=MO", "2027-03-01T14:00:00Z", 30, "America/Chicago", "2027-03-01T00:00:00Z", "2027-03-30T00:00:00Z"), ["2027-03-01T14:00:00.000Z", "2027-03-08T14:00:00.000Z", "2027-03-15T13:00:00.000Z", "2027-03-22T13:00:00.000Z", "2027-03-29T13:00:00.000Z"]);
  eq("A3 a late-evening local time keeps its local time (11:30 PM Tokyo, weekly)", expand("FREQ=WEEKLY", "2026-10-12T14:30:00Z", 60, "Asia/Tokyo", "2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z"), ["2026-10-12T14:30:00.000Z", "2026-10-19T14:30:00.000Z", "2026-10-26T14:30:00.000Z"]);
}

// ================= B. the examples from the standard (RFC 5545) =================
{
  const ny = (rule: string) => days(expand(rule, "1997-08-05T13:00:00Z", 60, "America/New_York", "1997-08-01T00:00:00Z", "1997-09-30T00:00:00Z"));
  eq("B1 every other week on Tue and Sun, 4 times, week starts Monday: Aug 5, 10, 19, 24", ny("FREQ=WEEKLY;INTERVAL=2;COUNT=4;WKST=MO;BYDAY=TU,SU"), ["1997-08-05", "1997-08-10", "1997-08-19", "1997-08-24"]);
  eq("B2 ...the SAME rule with the week starting Sunday gives different dates: Aug 5, 17, 19, 31", ny("FREQ=WEEKLY;INTERVAL=2;COUNT=4;WKST=SU;BYDAY=TU,SU"), ["1997-08-05", "1997-08-17", "1997-08-19", "1997-08-31"]);
  eq("B3 daily, 10 times", days(expand("FREQ=DAILY;COUNT=10", "1997-09-02T13:00:00Z", 60, "America/New_York", "1997-09-01T00:00:00Z", "1997-12-01T00:00:00Z")), ["1997-09-02", "1997-09-03", "1997-09-04", "1997-09-05", "1997-09-06", "1997-09-07", "1997-09-08", "1997-09-09", "1997-09-10", "1997-09-11"]);
  eq("B4 every other day until a plain date (inclusive)", days(expand("FREQ=DAILY;INTERVAL=2;UNTIL=19970910", "1997-09-02T13:00:00Z", 60, "America/New_York", "1997-09-01T00:00:00Z", "1997-12-01T00:00:00Z")), ["1997-09-02", "1997-09-04", "1997-09-06", "1997-09-08", "1997-09-10"]);
  eq("B5 until an exact time ends mid-window (the 9th at 13:00Z is allowed, the 10th is not)", days(expand("FREQ=DAILY;UNTIL=19970909T130000Z", "1997-09-07T13:00:00Z", 60, "America/New_York", "1997-09-01T00:00:00Z", "1997-12-01T00:00:00Z")), ["1997-09-07", "1997-09-08", "1997-09-09"]);
}

// ================= C. weekly and monthly shapes =================
{
  const chi = (rule: string, start: string, from: string, to: string) => days(expand(rule, start, 60, "America/Chicago", from, to));
  eq("C1 weekly with no weekday given repeats on the weekday of the first occurrence (Wednesdays)", chi("FREQ=WEEKLY", "2026-10-14T14:00:00Z", "2026-10-01T00:00:00Z", "2026-11-05T00:00:00Z"), ["2026-10-14", "2026-10-21", "2026-10-28", "2026-11-04"]);
  eq("C2 weekly on Mon, Wed, Fri", chi("FREQ=WEEKLY;BYDAY=MO,WE,FR", "2026-10-12T14:00:00Z", "2026-10-01T00:00:00Z", "2026-10-24T00:00:00Z"), ["2026-10-12", "2026-10-14", "2026-10-16", "2026-10-19", "2026-10-21", "2026-10-23"]);
  eq("C3 monthly on the 15th", chi("FREQ=MONTHLY;BYMONTHDAY=15", "2027-01-15T15:00:00Z", "2027-01-01T00:00:00Z", "2027-05-01T00:00:00Z"), ["2027-01-15", "2027-02-15", "2027-03-15", "2027-04-15"]);
  eq("C4 monthly on the second Tuesday", chi("FREQ=MONTHLY;BYDAY=2TU", "2026-10-13T14:00:00Z", "2026-10-01T00:00:00Z", "2027-01-15T00:00:00Z"), ["2026-10-13", "2026-11-10", "2026-12-08", "2027-01-12"]);
  eq("C5 monthly on the LAST Friday", chi("FREQ=MONTHLY;BYDAY=-1FR", "2026-10-30T14:00:00Z", "2026-10-01T00:00:00Z", "2027-01-15T00:00:00Z"), ["2026-10-30", "2026-11-27", "2026-12-25"]);
  eq("C6 monthly on the 31st skips months that have no 31st", chi("FREQ=MONTHLY", "2027-01-31T15:00:00Z", "2027-01-01T00:00:00Z", "2027-06-30T00:00:00Z"), ["2027-01-31", "2027-03-31", "2027-05-31"]);
  eq("C7 every OTHER month", chi("FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1", "2026-10-01T15:00:00Z", "2026-10-01T00:00:00Z", "2027-04-01T00:00:00Z"), ["2026-10-01", "2026-12-01", "2027-02-01"]);
}

// ================= D. series that started long ago, ended, or overlap the edge of the window =================
{
  const t0 = Date.now();
  const old = days(expand("FREQ=WEEKLY;BYDAY=MO", "2023-01-02T14:00:00Z", 30, "America/Chicago", "2026-10-08T05:00:00Z", "2026-11-08T06:00:00Z"));
  check("D1 a weekly series that began 3.8 years ago gives just the Mondays in the window, quickly", JSON.stringify(old) === JSON.stringify(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]) && Date.now() - t0 < 1500, `${JSON.stringify(old)} in ${Date.now() - t0} ms`);
  const t1 = Date.now();
  const daily = days(expand("FREQ=DAILY", "2021-01-01T14:00:00Z", 30, "America/Chicago", "2026-10-08T05:00:00Z", "2026-10-12T05:00:00Z"));
  check("D2 a DAILY series 5.8 years old is still fast and right", JSON.stringify(daily) === JSON.stringify(["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]) && Date.now() - t1 < 1500, `${JSON.stringify(daily)} in ${Date.now() - t1} ms`);
  eq("D3 a series whose COUNT ran out long ago gives nothing", expand("FREQ=WEEKLY;COUNT=3", "2024-01-01T14:00:00Z", 30, "America/Chicago", "2026-10-08T05:00:00Z", "2026-11-08T06:00:00Z"), []);
  eq("D4 a series whose UNTIL passed long ago gives nothing", expand("FREQ=WEEKLY;UNTIL=20250101", "2024-01-01T14:00:00Z", 30, "America/Chicago", "2026-10-08T05:00:00Z", "2026-11-08T06:00:00Z"), []);
  eq("D5 an occurrence that began before the window but is still running at its start is included", expand("FREQ=DAILY", "2026-10-06T12:00:00Z", 24 * 60, "UTC", "2026-10-08T05:00:00Z", "2026-10-09T00:00:00Z"), ["2026-10-07T12:00:00.000Z", "2026-10-08T12:00:00.000Z"]);
  eq("D6 an occurrence that has already ended before the window is not included", expand("FREQ=DAILY", "2026-10-06T12:00:00Z", 60, "UTC", "2026-10-08T05:00:00Z", "2026-10-09T00:00:00Z"), ["2026-10-08T12:00:00.000Z"]);
  const capped = expand("FREQ=DAILY", "2026-10-01T12:00:00Z", 60, "UTC", "2026-10-01T00:00:00Z", "2030-01-01T00:00:00Z");
  check("D7 a runaway window is capped at 400 occurrences", capped.length === 400, String(capped.length));
}

// ================= E. rules we do NOT guess at =================
{
  const bad = (text: string, needle: RegExp) => { const p = parseRepeatRule(text); check(`E ${JSON.stringify(text)} -> unsupported (${needle})`, "unsupported" in p && needle.test(p.unsupported), JSON.stringify(p)); };
  bad("FREQ=YEARLY;BYMONTH=10", /BYMONTH|YEARLY/);
  bad("FREQ=HOURLY", /HOURLY/);
  bad("FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU,WE,TH,FR", /BYSETPOS/);
  bad("INTERVAL=1", /no frequency/);
  bad("FREQ=WEEKLY;GARBAGE", /could not read/);
  bad("FREQ=WEEKLY;INTERVAL=0", /INTERVAL/);
  bad("FREQ=WEEKLY;COUNT=2;UNTIL=20270101", /both COUNT and UNTIL/);
  bad("FREQ=WEEKLY;BYDAY=2MO", /numbered weekday outside a monthly/);
  bad("FREQ=DAILY;BYDAY=MO", /filters a daily rule/);
  bad("FREQ=WEEKLY;BYMONTHDAY=3", /BYMONTHDAY outside a monthly/);
  bad("FREQ=WEEKLY;WKST=XX", /WKST/);
  bad("FREQ=WEEKLY;BYDAY=XYZ", /BYDAY/);
  bad("FREQ=WEEKLY;UNTIL=soon", /UNTIL/);
  bad("", /no frequency/);
  const ok = parseRepeatRule("RRULE:FREQ=WEEKLY;INTERVAL=1;WKST=SU;BYDAY=MO");
  check("E the real rule parses (with or without a leading RRULE:)", "rule" in ok && ok.rule.freq === "WEEKLY" && ok.rule.wkst === 0 && ok.rule.byDay[0].day === 1);
}

// ================= F. a whole event =================
{
  const DRAY = "pro_" + "d".repeat(32), MATT = "pro_" + "e".repeat(32);
  const window = { from: new Date("2026-10-08T05:00:00Z"), to: new Date("2026-11-08T06:00:00Z"), timeZone: "America/Chicago" };
  const real = { id: "evt_" + "c".repeat(26) + "c644c1", name: "Weekly thing", recurrence_rule: "FREQ=WEEKLY;INTERVAL=1;WKST=SU;BYDAY=MO", schedule: { start_time: "2026-10-12T13:00:00Z", end_time: "2026-10-12T13:30:00Z", time_zone: "America/Chicago" }, all_day: false, assigned_employees: [{ id: DRAY }, { id: MATT }] };
  const r = eventToOccurrences(real, window);
  eq("F1 the real event becomes 4 occurrences x 2 people = 8 rows", [r.rows.length, r.skip], [8, null]);
  eq("F2 each occurrence has its OWN key, its own times, and the same 30-minute length", [...new Set(r.rows.map((x) => x.hcpEventKey))].length === 4 && r.rows.every((x) => x.endTime.getTime() - x.startTime.getTime() === 30 * 60000), true);
  check("F3 keys look like event:<id>@<start>", r.rows[0].hcpEventKey === `event:${real.id}@2026-10-12T13:00:00.000Z`, r.rows[0].hcpEventKey);
  eq("F4 the repeat info: 4 occurrences, nothing unsupported, and the date the normal read stops reaching it", [r.repeat!.occurrencesInWindow, r.repeat!.unsupported, r.repeat!.visibleUntil, r.repeat!.event], [4, null, new Date(Date.parse("2026-10-12T13:00:00Z") + EVENTS_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10), "c644c1"]);
  const plain = eventToOccurrences({ ...real, recurrence_rule: null }, window);
  eq("F5 an event with no repeat rule is unchanged: 1 occurrence x 2 people, no repeat info", [plain.rows.length, plain.repeat], [2, null]);
  const odd = eventToOccurrences({ ...real, recurrence_rule: "FREQ=YEARLY" }, window);
  eq("F6 an unsupported rule keeps the first occurrence and says why", [odd.rows.length, odd.repeat!.unsupported !== null, odd.repeat!.occurrencesInWindow], [2, true, 1]);
  const weird = eventToOccurrences({ ...real, recurrence_rule: { freq: "weekly" } as unknown as string }, window);
  eq("F7 a repeat rule that is not text is reported, not crashed on", [weird.rows.length, weird.repeat!.unsupported], [2, "the repeat rule is not text"]);
  const tzEvent = eventToOccurrences({ ...real, schedule: { ...real.schedule, time_zone: "Not/AZone" } }, window);
  eq("F8 an invalid time zone on the event falls back to the business time zone", tzEvent.rows.length, 8);
  const skipped = eventToOccurrences({ ...real, canceled_at: "2026-10-01T00:00:00Z" }, window);
  eq("F9 a canceled repeating event is skipped like any other", [skipped.rows.length, skipped.skip], [0, "canceled"]);
  const alone = eventToOccurrences({ ...real, recurrence_rule: "FREQ=WEEKLY;BYDAY=TU" }, window);
  check("F10 the occurrence HCP actually lists is kept even when the rule would not produce it (a Monday listed under a Tuesday rule)", alone.rows.some((x) => x.startTime.toISOString() === "2026-10-12T13:00:00.000Z") && alone.rows.some((x) => x.startTime.toISOString() === "2026-10-13T13:00:00.000Z"), alone.rows.map((x) => x.startTime.toISOString()).join(" "));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
