// @ts-nocheck
import { generateDispatchAvailability, generateDayAvailability, bestFit, soonestOpening, type BusyBlock, type FitOptions } from "../../src/lib/availability.ts";
import { makeProximity } from "../../src/lib/zip-distance.ts";
import { ZIP_CENTROIDS } from "../../src/data/ar-zip-centroids.ts";

let passes = 0, failures = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const CT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const t = (d: Date) => CT.format(d);                                   // "09:30"
const rng = (a: { start: Date; end: Date }) => `${t(a.start)}-${t(a.end)}`;
const NOW = new Date("2026-10-05T15:00:00Z");                          // Mon 10:00 AM CDT
const H = (day: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 5 + day, 15 + (hh - 10), mm));  // CDT wall clock on NOW's date + day
const call = (day: number, sh: number, sm: number, eh: number, em: number, zip: string | null = null): BusyBlock => ({ start: H(day, sh, sm), end: H(day, eh, em), zip });
const fit = (customerZip: string | null): FitOptions => ({ customerZip, proximity: makeProximity(ZIP_CENTROIDS) });
const view = (busy: BusyBlock[], zip: string | null = "72201") => generateDispatchAvailability(NOW, busy, fit(zip));
const tomorrow = (busy: BusyBlock[], zip: string | null = "72201") => view(busy, zip).tomorrow;

// ---------- A. structure ----------
{
  const v = tomorrow([]);
  eq("A1 empty day: one gap covering the whole window", v.gaps.map(rng), ["08:00-18:00"]);
  eq("A1 window is business hours", rng(v.window), "08:00-18:00");
  check("A1 nothing booked, no neighbors, fit open", v.booked.length === 0 && v.gaps[0].prev === null && v.gaps[0].next === null && v.gaps[0].fit === "open");
  check("A1 tomorrow has no 'passed' shading", v.passedUntil === null);
}
{
  const v = tomorrow([call(1, 9, 0, 11, 0, "72201")]);
  eq("A2 booked block shaded with its zip", v.booked.map((b) => [rng(b), b.zip]), [["09:00-11:00", "72201"]]);
  eq("A2 two gaps around the call", v.gaps.map(rng), ["08:00-09:00", "11:00-18:00"]);
  check("A2 first gap: nothing before, the 72201 call after it", v.gaps[0].prev === null && v.gaps[0].next?.zip === "72201" && t(v.gaps[0].next.at) === "09:00");
  check("A2 second gap: the 72201 call before it, nothing after", v.gaps[1].next === null && v.gaps[1].prev?.zip === "72201" && t(v.gaps[1].prev.at) === "11:00");
  eq("A2 slots are exactly the gaps' slots, in order", v.slots.map((s) => s.start.toISOString()), v.gaps.flatMap((g) => g.slots).map((s) => s.start.toISOString()));
}
check("A3 zip+4 is normalized to 5 digits", tomorrow([call(1, 9, 0, 10, 0, "72201-1234")]).booked[0].zip === "72201");
check("A3 junk zip becomes null, not a crash", tomorrow([call(1, 9, 0, 10, 0, "n/a")]).booked[0].zip === null && tomorrow([call(1, 9, 0, 10, 0, undefined as unknown as string)]).booked[0].zip === null);
{
  const v = tomorrow([call(1, 6, 0, 9, 0, "72201"), call(1, 17, 0, 20, 0, "72201")]);
  eq("A4 calls running past business hours are clipped for shading", v.booked.map(rng), ["08:00-09:00", "17:00-18:00"]);
  eq("A4 gap between them", v.gaps.map(rng), ["09:00-17:00"]);
}
{
  const v = tomorrow([call(1, 9, 0, 11, 0, "72201"), call(1, 10, 0, 12, 0, "72202")]);
  eq("A5 overlapping calls: one gap after both ends", v.gaps.map(rng), ["08:00-09:00", "12:00-18:00"]);
  check("A5 the call before the later gap is the one that ends last (72202)", v.gaps[1].prev?.zip === "72202");
}
eq("A6 a gap under an hour is not a gap", tomorrow([call(1, 8, 0, 9, 30, "72201"), call(1, 10, 0, 18, 0, "72201")]).gaps, []);
{
  const v = tomorrow([call(1, 8, 0, 9, 0, "72201"), call(1, 10, 0, 18, 0, "72201")]);
  eq("A7 a gap of exactly an hour is a gap with one slot", [v.gaps.map(rng), v.gaps[0]?.slots.length], [["09:00-10:00"], 1]);
}
eq("A8 fully booked day: no gaps, no slots, all shaded", (() => { const v = tomorrow([call(1, 8, 0, 18, 0, "72201")]); return [v.gaps.length, v.slots.length, v.booked.length]; })(), [0, 0, 1]);

// ---------- B. start times flush against calls ----------
{
  const v = tomorrow([call(1, 9, 30, 10, 15, "72201"), call(1, 13, 15, 14, 0, "72201")]);
  const gap = v.gaps.find((g) => rng(g) === "10:15-13:15")!;
  const starts = gap.slots.map((s) => t(s.start));
  check("B1 offers the 30-minute grid inside an odd-length gap", ["10:30", "11:00", "11:30", "12:00"].every((x) => starts.includes(x)), starts.join(" "));
  check("B1 ALSO offers right after the earlier call (10:15)", starts[0] === "10:15", starts.join(" "));
  check("B1 ALSO offers ending right as the next call starts (12:15)", starts.at(-1) === "12:15", starts.join(" "));
  check("B1 slots never overlap a booked call", v.slots.every((s) => !v.booked.some((b) => s.start < b.end && s.end > b.start)));
  check("B1 no duplicate start times", new Set(starts).size === starts.length);
}
{
  const v = tomorrow([call(1, 8, 0, 9, 15, "72201"), call(1, 10, 15, 18, 0, "72201")]);
  eq("B2 a 60-minute gap off the 30-minute grid is still bookable (09:15)", v.gaps.map((g) => [rng(g), g.slots.map((s) => t(s.start))]), [["09:15-10:15", ["09:15"]]]);
}
{
  const v = tomorrow([]);
  eq("B3 an untouched day gets only grid starts (no flush extras)", [t(v.slots[0].start), t(v.slots.at(-1)!.start), v.slots.length], ["08:00", "17:00", 19]);
}

// ---------- C. today ----------
{
  const nowAt = new Date(Date.UTC(2026, 9, 5, 15, 7));                 // 10:07 AM CDT
  const a = generateDispatchAvailability(nowAt, [call(0, 9, 0, 10, 0, "72201"), call(0, 13, 0, 14, 0, "72201")], fit("72201"));
  const v = a.today;
  eq("C1 today: time before now is marked passed", t(v.passedUntil!), "10:07");
  check("C1 today: the first open stretch starts at now", t(v.gaps[0].start) === "10:07", t(v.gaps[0].start));
  check("C1 a call that ended minutes ago counts as the one before", v.gaps[0].prev?.zip === "72201" && t(v.gaps[0].prev.at) === "10:00");
  check("C1 first slot is the next grid time, not a start before now", t(v.slots[0].start) === "10:30", t(v.slots[0].start));
  const old = generateDispatchAvailability(nowAt, [call(0, 8, 0, 8, 30, "72201")], fit("72201")).today;
  check("C2 a call that ended over an hour ago is NOT treated as the call before", old.gaps[0].prev === null);
  const late = generateDispatchAvailability(new Date(Date.UTC(2026, 9, 5, 23, 30)), [], fit("72201")).today;
  check("C3 after close: all shaded as passed, nothing open", late.gaps.length === 0 && late.cutoffPassed === true && late.passedUntil!.getTime() === late.window.end.getTime());
}

// ---------- D. scoring against the customer's zip (customer = 72201) ----------
const gapBetween = (zipA: string | null, zipB: string | null, customer: string | null = "72201") =>
  tomorrow([call(1, 8, 0, 9, 0, zipA), call(1, 12, 0, 18, 0, zipB)], customer).gaps[0];
{
  const g = gapBetween("72201", "72202");
  check("D1 between a same-zip call and a near-zip call: between-two", g.fit === "between-two" && g.fitMinutes === 3, JSON.stringify([g.fit, g.fitMinutes]));
  eq("D1 neighbors report near, same-zip and minutes", [g.prev!.near, g.prev!.sameZip, g.prev!.minutes, g.next!.near, g.next!.sameZip, g.next!.minutes], [true, true, 0, true, false, 3]);
  eq("D2 same zip both sides: between-two, 0 minutes", [gapBetween("72201", "72201").fit, gapBetween("72201", "72201").fitMinutes], ["between-two", 0]);
  eq("D3 one near neighbor, one far: next-to-one", [gapBetween("72201", "72015").fit, gapBetween("72201", "72015").fitMinutes], ["next-to-one", 0]);
  eq("D3b ... either side", gapBetween("72015", "72201").fit, "next-to-one");
  eq("D4 both far: open, no minutes", [gapBetween("72015", "72015").fit, gapBetween("72015", "72015").fitMinutes], ["open", null]);
  eq("D5 72205 is 10 min away: near; 72204 is 11: not", [gapBetween("72205", "72205").fit, gapBetween("72204", "72204").fit], ["between-two", "open"]);
  eq("D6 an unknown zip is never 'near' (and never crashes)", [gapBetween("90210", "72201").fit, gapBetween(null, null).fit], ["next-to-one", "open"]);
  const edge = tomorrow([call(1, 9, 0, 18, 0, "72201")]).gaps[0];
  eq("D7 first-of-day gap with a near call after it: next-to-one", [edge.prev, edge.fit], [null, "next-to-one"]);
  const tail = tomorrow([call(1, 8, 0, 15, 0, "72201")]).gaps[0];
  eq("D8 end-of-day gap with a near call before it: next-to-one", [tail.next, tail.fit], [null, "next-to-one"]);
  const noZip = gapBetween("72201", "72201", null);
  check("D9 no customer zip: never scored (open), neighbors still shown but not 'near'", noZip.fit === "open" && noZip.prev!.zip === "72201" && noZip.prev!.near === false && noZip.prev!.minutes === null);
  eq("D10 customer in a far zip scores the same gap as open", gapBetween("72201", "72201", "72015").fit, "open");
  eq("D11 customer zip+4 works", gapBetween("72201", "72201", "72201-5555").fit, "between-two");
}

// ---------- E. the best fit across the default view ----------
{
  // today plain open; day 4 (Thu) has a gap between two 72201 calls; day 5 has a 72205/72205 gap
  const busy = [call(3, 8, 0, 9, 0, "72201"), call(3, 13, 0, 18, 0, "72201"), call(4, 8, 0, 9, 0, "72205"), call(4, 13, 0, 18, 0, "72205")];
  const a = view(busy);
  const b = bestFit(a)!;
  eq("E1 a between-two gap days away beats plain open time today", [b.kind, b.date, b.dayLabel, rng(b)], ["between-two", "2026-10-08", null, "09:00-13:00"]);
  eq("E1 names the neighbors", [b.prevZip, b.nextZip, b.minutes], ["72201", "72201", 0]);
  eq("E2 the suggested start is flush against the earlier near call", t(b.slotStart), "09:00");
}
{
  const busy = [call(1, 8, 0, 9, 0, "72205"), call(1, 13, 0, 18, 0, "72205"), call(2, 8, 0, 9, 0, "72201"), call(2, 13, 0, 18, 0, "72201")];
  const b = bestFit(view(busy))!;
  eq("E3 two between-two gaps: the shorter combined drive wins even though it is later", [b.date, b.minutes], ["2026-10-07", 0]);
}
{
  const busy = [call(1, 8, 0, 9, 0, "72201"), call(1, 13, 0, 18, 0, "72201"), call(2, 8, 0, 9, 0, "72201"), call(2, 13, 0, 18, 0, "72201")];
  eq("E4 exact tie goes to the earlier day", bestFit(view(busy))!.date, "2026-10-06");
}
{
  const nextOnly = [call(1, 9, 0, 18, 0, "72201")];  // tomorrow: gap 8-9 with a near call after it only
  const b = bestFit(view(nextOnly))!;
  eq("E5 next-to-one beats plain open", [b.kind, b.dayLabel], ["next-to-one", "Tomorrow"]);
  eq("E5 suggested start for a gap with the near call AFTER it is flush before that call (08:00 here)", t(b.slotStart), "08:00");
  const late = [call(1, 8, 0, 15, 0, "72201")];
  const b2 = bestFit(view(late))!;
  eq("E6 near call only BEFORE the gap: suggest right after it", [b2.kind, t(b2.slotStart)], ["next-to-one", "15:00"]);
  const mid = bestFit(view([call(1, 8, 0, 9, 0, "72015"), call(1, 14, 0, 18, 0, "72201")]))!;
  eq("E7 near call only AFTER a long gap: suggest ending right as it starts (13:00-14:00)", [mid.kind, t(mid.slotStart)], ["next-to-one", "13:00"]);
}
{
  const a = view([]);
  const b = bestFit(a)!;
  eq("E8 nothing booked anywhere: plain open, earliest", [b.kind, b.date, b.dayLabel], ["open", "2026-10-05", "Today"]);
  const s = soonestOpening(a)!;
  eq("E9 soonest opening is today's first slot", [s.date, s.dayLabel, t(s.start)], ["2026-10-05", "Today", "10:00"]);
  const closed = generateDispatchAvailability(new Date(Date.UTC(2026, 9, 5, 23, 30)), [], fit("72201"));
  eq("E10 after close: soonest opening is tomorrow morning", [soonestOpening(closed)!.dayLabel, t(soonestOpening(closed)!.start)], ["Tomorrow", "08:00"]);
  const full = Array.from({ length: 8 }, (_, d) => call(d, 0, 0, 23, 59, "72201"));
  const f = view(full);
  eq("E11 everything booked: no best fit, no soonest opening", [bestFit(f), soonestOpening(f)], [null, null]);
}

// ---------- F. one specific day, on request ----------
{
  const busy = [call(10, 9, 0, 11, 0, "72201"), call(10, 14, 0, 16, 0, "72202")];
  const d = generateDayAvailability(NOW, busy, "2026-10-15", fit("72201"));
  eq("F1 a far day carries shading and gaps too", [d.booked.map((b) => [rng(b), b.zip]), d.gaps.map(rng)], [[["09:00-11:00", "72201"], ["14:00-16:00", "72202"]], ["08:00-09:00", "11:00-14:00", "16:00-18:00"]]);
  check("F1 the middle gap is scored between-two", d.gaps[1].fit === "between-two", d.gaps[1].fit);
  const t0 = generateDayAvailability(NOW, [], "2026-10-05", fit("72201"));
  check("F2 today on request: passed shading and starts from now", t(t0.passedUntil!) === "10:00" && t(t0.slots[0].start) === "10:00");
  const past = generateDayAvailability(NOW, [], "2026-10-01", fit("72201"));
  check("F3 a past day is empty but still has a window", past.gaps.length === 0 && past.booked.length === 0 && rng(past.window) === "08:00-18:00" && past.cutoffPassed);
  const same = view(busy.slice(0, 0).concat([call(2, 9, 0, 11, 0, "72201")])).later.days.find((x) => x.date === "2026-10-07")!;
  const solo = generateDayAvailability(NOW, [call(2, 9, 0, 11, 0, "72201")], "2026-10-07", fit("72201"));
  check("F4 a day asked for specifically matches the same day in the default view", JSON.stringify(same.gaps) === JSON.stringify(solo.gaps) && JSON.stringify(same.booked) === JSON.stringify(solo.booked));
}

// ---------- G. daylight saving ----------
{
  const a = generateDayAvailability(NOW, [{ start: new Date("2026-11-01T15:00:00Z"), end: new Date("2026-11-01T17:00:00Z"), zip: "72201" }], "2026-11-01", fit("72201"));
  eq("G1 Nov 1 (clocks fall back): window 8-6 CST, call 9-11 CST", [a.window.start.toISOString(), a.window.end.toISOString(), a.gaps.map((g) => [g.start.toISOString(), g.end.toISOString()])],
    [["2026-11-01T14:00:00.000Z", "2026-11-02T00:00:00.000Z", [["2026-11-01T14:00:00.000Z", "2026-11-01T15:00:00.000Z"], ["2026-11-01T17:00:00.000Z", "2026-11-02T00:00:00.000Z"]]]].flat());
}

// ---------- H. calendar events (errands, time off, meetings) ----------
{
  const evt = (day: number, sh: number, sm: number, eh: number, em: number, label: string | null, zip: string | null = null): BusyBlock => ({ ...call(day, sh, sm, eh, em, zip), kind: "event", label });
  const v1 = tomorrow([evt(1, 8, 0, 9, 30, "Product pickup", "72201")]);
  eq("H1 an event is shaded, with its kind and title, and no zip even if one was supplied", v1.booked.map((b) => [b.kind, b.label, b.zip, rng(b)]), [["event", "Product pickup", null, "08:00-09:30"]]);
  eq("H1 it blocks the time: the day opens after it", v1.gaps.map(rng), ["09:30-18:00"]);
  eq("H1 no start time overlaps it", v1.slots.every((s) => s.start >= H(1, 9, 30)), true);
  const v2 = tomorrow([call(1, 9, 0, 10, 0, "72201")]);
  eq("H2 a job carries kind job and no title", v2.booked.map((b) => [b.kind, b.label]), [["job", null]]);
  const v2b = tomorrow([{ ...call(1, 9, 0, 10, 0, "72201"), label: "should be ignored" }]);
  eq("H2 a title on a job is ignored", v2b.booked[0].label, null);
  const g3 = tomorrow([evt(1, 8, 0, 9, 0, "Product pickup")]).gaps[0];
  eq("H3 the gap after an event knows it follows an event, and by its title", [g3.prev!.kind, g3.prev!.label, g3.prev!.near, g3.prev!.minutes, g3.fit], ["event", "Product pickup", false, null, "open"]);
  const g4 = tomorrow([evt(1, 8, 0, 9, 0, "Product pickup"), call(1, 12, 0, 18, 0, "72201")]).gaps[0];
  eq("H4 between an event and a nearby job is only next-to-one, never between-two", [g4.fit, g4.prev!.kind, g4.next!.kind, g4.next!.near], ["next-to-one", "event", "job", true]);
  eq("H5 between two events: just open", tomorrow([evt(1, 8, 0, 9, 0, "A"), evt(1, 12, 0, 18, 0, "B")]).gaps[0].fit, "open");
  const v6 = tomorrow([evt(1, 8, 0, 10, 0, "Training"), call(1, 9, 0, 11, 0, "72201")]);
  eq("H6 an event overlapping a job: both are shaded and the day opens after both", [v6.booked.map((b) => b.kind), v6.gaps.map(rng)], [["event", "job"], ["11:00-18:00"]]);
  const v7 = tomorrow([evt(1, 8, 0, 18, 0, "PTO")]);
  eq("H7 an all-day event: no open time, but the day still reports the event", [v7.gaps.length, v7.slots.length, v7.booked.map((b) => b.label)], [0, 0, ["PTO"]]);
  const b8 = bestFit(view([evt(1, 8, 0, 9, 0, "Errand"), call(1, 13, 0, 18, 0, "72201"), call(2, 8, 0, 9, 0, "72201"), call(2, 13, 0, 18, 0, "72201")]))!;
  eq("H8 a real stack between two nearby JOBS beats a gap that only touches an event", [b8.kind, b8.date], ["between-two", "2026-10-07"]);
  const v9 = generateDayAvailability(NOW, [evt(10, 7, 0, 8, 30, "Product pickup")], "2026-10-15", fit("72201"));
  eq("H9 a day asked for specifically carries events too (clipped to business hours)", v9.booked.map((b) => [b.kind, b.label, rng(b)]), [["event", "Product pickup", "08:00-08:30"]]);
  const v10 = tomorrow([evt(1, 7, 0, 8, 30, null)]);
  eq("H10 an event with no title is still shown", v10.booked.map((b) => [b.kind, b.label]), [["event", null]]);
}

console.log(`TZ=${process.env.TZ}  ${passes} passed, ${failures} failed`);
console.log("FINGERPRINT", JSON.stringify(view([call(3, 8, 0, 9, 0, "72201"), call(3, 13, 0, 18, 0, "72201")])));
process.exit(failures ? 1 : 0);
