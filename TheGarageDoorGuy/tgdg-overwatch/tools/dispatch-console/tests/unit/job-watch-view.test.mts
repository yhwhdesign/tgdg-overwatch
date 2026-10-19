// @ts-nocheck
import { createRequire } from "node:module";
import * as V from "../../src/lib/job-watch-view.ts";
const require = createRequire(import.meta.url);
const L = require("../../../../src/shell-logic.js"); // the desktop panel's version: the website must say the same things
let passes = 0, failures = 0;
const eq = (n: string, a: unknown, b: unknown) => { if (JSON.stringify(a) === JSON.stringify(b)) passes++; else { failures++; console.log(`FAIL ${n}\n   got  ${JSON.stringify(a)}\n   want ${JSON.stringify(b)}`); } };
const ok = (n: string, c: boolean) => eq(n, !!c, true);

const NOW = Date.parse("2026-10-19T23:00:00Z");
const alertsIn = [
  { id: "job_1@90", kind: "install", label: "Install #100", techs: ["Alex", "Blake", "Casey"], startedAt: "2026-10-19T20:55:00.000Z", startedLabel: "3:55 PM", minutesOnJob: 125, limitMinutes: 90, url: "https://pro.housecallpro.com/app/jobs/job_1" },
  { id: "job_2@60", kind: "service", label: "Repair #200", techs: ["Dana"], startedAt: "2026-10-19T22:00:00.000Z", startedLabel: "5:00 PM", minutesOnJob: 61, limitMinutes: 60, url: "https://evil.example.com/x" },
  { id: "csr_3@3d", kind: "estimate", label: "Estimate #13145 ($192)", techs: ["Stoney Wade", "Braden Lewis"], startedAt: "2026-10-16T13:58:08.000Z", startedLabel: "Oct 16", minutesOnJob: 4859, limitMinutes: 4320, url: "https://pro.housecallpro.com/app/estimates/csr_3" },
  { id: "x", kind: "weird", label: null, techs: [], startedAt: 5, startedLabel: 7, minutesOnJob: "abc", limitMinutes: null, url: 12 },
];
const doneIn = [
  { id: "job_a#1", kind: "service", label: "Residential service #40883", techs: ["Josh Bayliss"], completedAt: "2026-10-19T22:11:58.000Z", completedLabel: "5:11 PM", minutesOnJob: 8, notes: ["n1", "  n2  ", "n3", "n4"], notesPending: false, notesHidden: false, url: "https://pro.housecallpro.com/app/jobs/job_a" },
  { id: "job_b#2", kind: "estimate", label: "Estimate #1", techs: ["Kris"], completedAt: "", completedLabel: "", minutesOnJob: null, notes: [], notesPending: true, notesHidden: false, url: null },
  { id: "job_c#3", kind: "install", label: "Install #3", techs: ["Lee", "Max"], completedAt: "x", completedLabel: "1:00 PM", minutesOnJob: 130, notes: ["hidden text"], notesPending: false, notesHidden: true, url: "http://pro.housecallpro.com/a" },
  { id: "job_d#4", kind: "service", label: "S", techs: ["Z"], completedAt: "", completedLabel: "2:00 PM", minutesOnJob: 0, notes: [], notesPending: false, notesHidden: false, url: "https://pro.housecallpro.com/app/jobs/d" },
  { id: 5, label: "no id" }, null, "junk",
];

// ---- cleaning: same result as the desktop panel
eq("V1 cleanAlerts matches the panel's", V.cleanAlerts(alertsIn), L.cleanAlerts(alertsIn));
eq("V2 cleanCompletions matches the panel's", V.cleanCompletions(doneIn), L.cleanCompletions(doneIn));
eq("V3 junk lists become empty", [V.cleanAlerts(null), V.cleanAlerts("x"), V.cleanCompletions(undefined), V.cleanCompletions({})], [[], [], [], []]);
eq("V4 a link outside Housecall Pro is dropped, a real one kept", [V.cleanAlerts(alertsIn)[1].url, V.cleanAlerts(alertsIn)[0].url], [null, "https://pro.housecallpro.com/app/jobs/job_1"]);
for (const u of ["http://pro.housecallpro.com/a", "https://user:pw@pro.housecallpro.com/a", "https://pro.housecallpro.com:8443/a", "https://housecallpro.com.evil.io/a", "javascript:alert(1)", "https://pro.housecallpro.com/a b", "", 5, null]) eq(`V5 unsafe link refused: ${String(u)}`, [V.safeJobUrl(u), L.safeJobUrl(u)], [null, null]);
eq("V6 a real Housecall Pro link passes in both", [V.safeJobUrl("https://pro.housecallpro.com/app/jobs/job_1"), L.safeJobUrl("https://pro.housecallpro.com/app/jobs/job_1")], ["https://pro.housecallpro.com/app/jobs/job_1", "https://pro.housecallpro.com/app/jobs/job_1"]);

// ---- wording: same as the panel (the website drops only the words "Click to dismiss.")
const strip = (s: string) => s.replace(/ Click to dismiss\.$/, "");
for (const a of V.cleanAlerts(alertsIn)) {
  const w = V.alertMessage(a, NOW), p = L.alertMessage(a, NOW);
  eq(`V7 alert title same: ${a.id}`, w.title, p.title);
  eq(`V7 alert detail same (minus the click hint): ${a.id}`, w.detail, strip(p.detail));
}
for (const c of V.cleanCompletions(doneIn)) eq(`V8 finished message same: ${c.id}`, V.completionMessage(c), L.completionMessage(c));
for (const m of [0, 1, 59, 60, 61, 90, 120, 125, 1440, 4859, -5, "x", null]) eq(`V9 duration ${m}`, V.formatDuration(m), L.formatDuration(m));
for (const n of [[], ["A"], ["A", "B"], ["A", "B", "C"], null, ["", "A"]]) eq(`V10 names ${JSON.stringify(n)}`, V.joinNames(n), L.joinNames(n));
eq("V11 estimate wording in days", V.alertMessage(V.cleanAlerts(alertsIn)[2], NOW).title, "Estimate #13145 ($192) has had no answer for 3 days");
eq("V12 the minutes keep counting from the start time even if the server's number is old", V.alertMessage({ ...V.cleanAlerts(alertsIn)[0], minutesOnJob: 10 }, NOW).title, 'Alex, Blake and Casey have been on "Install #100" for 2h 5m');

// ---- bars: order, dismissals, the limit of three
const A = V.cleanAlerts(alertsIn), D = V.cleanCompletions(doneIn);
let r = V.buildBars(A, D, {}, NOW);
eq("B1 at most 3 bars: the urgent red ones first, then green", r.shown.map((b) => b.id), ["job_1@90", "job_2@60", "csr_3@3d"]);
eq("B2 the rest are counted", r.more, A.length + D.length - 3);
r = V.buildBars(A, D, { "job_1@90": NOW, "job_2@60": NOW }, NOW);
eq("B3 dismissed bars are left out and the next ones move up", r.shown.map((b) => b.id), ["csr_3@3d", "x", "job_a#1"]);
r = V.buildBars([], D, {}, NOW);
eq("B4 with no overtime, finished jobs show as green bars", r.shown.map((b) => b.type), ["done", "done", "done"]);
eq("B5 nothing at all gives nothing", V.buildBars([], [], {}, NOW), { shown: [], more: 0 });
eq("B6 the limit can be changed", V.buildBars(A, D, {}, NOW, 1).shown.length, 1);

// ---- dismissal memory
eq("M1 a dismissal lasts a day, then is forgotten", V.pruneDismissed({ a: NOW - 1000, b: NOW - V.DISMISS_KEEP_MS - 1 }, NOW), { a: NOW - 1000 });
eq("M2 a time in the future is refused", V.pruneDismissed({ a: NOW + 10 * 60000 }, NOW), {});
eq("M3 junk is refused", V.pruneDismissed({ a: "x", "": NOW, b: NaN }, NOW), {});
eq("M4 matches the panel's rule", V.pruneDismissed({ a: NOW - 5, b: NOW - 9e7, c: NOW + 1e6 }, NOW), L.pruneDismissed({ a: NOW - 5, b: NOW - 9e7, c: NOW + 1e6 }, NOW));
eq("M5 unreadable saved text means none", [V.parseDismissed("{oops", NOW), V.parseDismissed(null, NOW), V.parseDismissed("[1,2]", NOW), V.parseDismissed('"s"', NOW)], [{}, {}, {}, {}]);
eq("M6 saved text is read back", V.parseDismissed(JSON.stringify({ a: NOW - 5 }), NOW), { a: NOW - 5 });
const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`id${i}`, NOW - i]));
eq("M7 the list is kept small", Object.keys(V.pruneDismissed(many, NOW)).length, V.MAX_DISMISSED);

// ---- checks and status
const good = { ok: true, checkedAt: "2026-10-19T22:57:32.681Z", watching: 2, cantTell: 1, ignoredOlder: 3, alerts: alertsIn, completed: doneIn };
let s = V.nextSnapshot(V.EMPTY_SNAPSHOT, { body: good, error: null }, "2026-10-19T23:00:00.000Z");
eq("S1 a good answer is taken in full", [s.state, s.watching, s.cantTell, s.ignoredOlder, s.alerts.length, s.completed.length, s.failures, s.checkedAt], ["ok", 2, 1, 3, 4, 4, 0, "2026-10-19T22:57:32.681Z"]);
let f = V.nextSnapshot(s, { body: null, error: "Can't reach the console." }, "t");
eq("S2 the first failure is 'trouble' and keeps the last alerts", [f.state, f.failures, f.alerts.length, f.error], ["trouble", 1, 4, "Can't reach the console."]);
f = V.nextSnapshot(V.nextSnapshot(f, { body: null, error: "e" }, "t"), { body: null, error: "e" }, "t");
eq("S3 the third failure in a row is 'offline'", [f.state, f.failures], ["offline", 3]);
eq("S4 one good answer clears it", V.nextSnapshot(f, { body: good, error: null }, "t").state, "ok");
eq("S5 {ok:false,error} from the server shows its message", V.nextSnapshot(V.EMPTY_SNAPSHOT, { body: { ok: false, error: "HCP key missing" }, error: null }, "t").error, "HCP key missing");
eq("S6 an answer without an alerts list is a failure", V.nextSnapshot(V.EMPTY_SNAPSHOT, { body: { ok: true }, error: null }, "t").state, "trouble");
eq("S7 numbers from the server are made safe", V.nextSnapshot(V.EMPTY_SNAPSHOT, { body: { ok: true, alerts: [], watching: -4, cantTell: "x" }, error: null }, "t").watching, 0);
eq("S8 no checkedAt in the answer uses our clock", V.nextSnapshot(V.EMPTY_SNAPSHOT, { body: { ok: true, alerts: [] }, error: null }, "NOWISO").checkedAt, "NOWISO");
const time = (iso: string) => "T";
eq("T1 nobody on a job", V.statusLine({ ...s, watching: 0, cantTell: 0, ignoredOlder: 0 }, time), { text: "No one on a job", tone: "ok", title: "Last checked T." });
eq("T2 one on a job", V.statusLine({ ...s, watching: 1, cantTell: 0, ignoredOlder: 0 }, time).text, "1 on a job");
eq("T3 several", V.statusLine({ ...s, watching: 4 }, time).text, "4 on jobs");
ok("T4 the tooltip mentions jobs with no Start tap and earlier-day jobs", /1 job in progress has no Start tap/.test(V.statusLine(s, time).title) && /3 jobs started on an earlier day/.test(V.statusLine(s, time).title));
eq("T5 offline says so and why", [V.statusLine(f, time).text, V.statusLine(f, time).tone, /can't check right now: e/.test(V.statusLine(f, time).title)], ["Job Watch offline", "offline", true]);
eq("T6 trouble keeps the count but shows the tone", V.statusLine({ ...s, state: "trouble", error: "x" }, time).tone, "trouble");
eq("E1 401 and other statuses are explained", [V.errorForStatus(401), V.errorForStatus(500)], ["Sign in again to turn Job Watch on.", "The console answered HTTP 500."]);

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
