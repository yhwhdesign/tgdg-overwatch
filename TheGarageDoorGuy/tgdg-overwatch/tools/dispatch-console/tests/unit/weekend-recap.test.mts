// @ts-nocheck
import * as W from "../../src/lib/weekend-recap.ts";
let passes = 0, failures = 0;
const eq = (n: string, a: unknown, b: unknown) => { if (JSON.stringify(a) === JSON.stringify(b)) passes++; else { failures++; console.log(`FAIL ${n}\n   got  ${JSON.stringify(a)}\n   want ${JSON.stringify(b)}`); } };
const ok = (n: string, c: boolean) => eq(n, !!c, true);
const TZ = "America/Chicago";
const at = (s: string) => new Date(s);

// ---- the window: Friday 6 PM to Sunday 10 PM, business time
let w = W.weekendWindow(at("2026-10-19T17:00:00Z"), 0, TZ); // Monday Oct 19, noon
eq("W1 on a Monday: the weekend that just ended (Fri Oct 16 6 PM CDT to Sun Oct 18 10 PM CDT)", [w.start.toISOString(), w.end.toISOString(), w.isCurrent, w.back], ["2026-10-16T23:00:00.000Z", "2026-10-19T03:00:00.000Z", false, 0]);
eq("W2 the label reads naturally", w.label, "Fri, Oct 16, 6 PM to Sun, Oct 18, 10 PM");
w = W.weekendWindow(at("2026-10-17T15:00:00Z"), 0, TZ); // Saturday morning
eq("W3 on a Saturday: this weekend, going on now", [w.start.toISOString(), w.isCurrent], ["2026-10-16T23:00:00.000Z", true]);
w = W.weekendWindow(at("2026-10-16T21:00:00Z"), 0, TZ); // Friday 4 PM
eq("W4 Friday afternoon: the weekend has not started, so still last weekend", w.start.toISOString(), "2026-10-09T23:00:00.000Z");
w = W.weekendWindow(at("2026-10-16T23:00:00Z"), 0, TZ); // Friday 6:00 PM exactly
eq("W5 at Friday 6:00 PM sharp it has started", [w.start.toISOString(), w.isCurrent], ["2026-10-16T23:00:00.000Z", true]);
w = W.weekendWindow(at("2026-10-16T22:59:00Z"), 0, TZ);
eq("W6 one minute before 6 PM it has not", w.start.toISOString(), "2026-10-09T23:00:00.000Z");
w = W.weekendWindow(at("2026-10-19T03:30:00Z"), 0, TZ); // Sunday 10:30 PM
eq("W7 Sunday 10:30 PM: that weekend is over but still the latest", [w.start.toISOString(), w.isCurrent], ["2026-10-16T23:00:00.000Z", false]);
eq("W8 back=1 is the weekend before, back=2 two before", [W.weekendWindow(at("2026-10-19T17:00:00Z"), 1, TZ).start.toISOString(), W.weekendWindow(at("2026-10-19T17:00:00Z"), 2, TZ).start.toISOString()], ["2026-10-09T23:00:00.000Z", "2026-10-02T23:00:00.000Z"]);
eq("W9 back is kept between 0 and 8, junk means 0", [W.weekendWindow(at("2026-10-19T17:00:00Z"), 99, TZ).back, W.weekendWindow(at("2026-10-19T17:00:00Z"), -3, TZ).back, W.weekendWindow(at("2026-10-19T17:00:00Z"), 1.5, TZ).back], [8, 0, 0]);
w = W.weekendWindow(at("2026-11-02T17:00:00Z"), 0, TZ); // Monday after the clocks went back (Nov 1)
eq("W10 across the fall-back change: starts 6 PM CDT Friday, ends 10 PM CST Sunday (an hour later in UTC)", [w.start.toISOString(), w.end.toISOString()], ["2026-10-30T23:00:00.000Z", "2026-11-02T04:00:00.000Z"]);
w = W.weekendWindow(at("2027-03-15T17:00:00Z"), 0, TZ); // Monday after the clocks went forward (Mar 14, 2027)
eq("W11 across the spring-forward change: 6 PM CST Friday to 10 PM CDT Sunday", [w.start.toISOString(), w.end.toISOString()], ["2027-03-13T00:00:00.000Z", "2027-03-15T03:00:00.000Z"]);
w = W.weekendWindow(at("2026-10-19T17:00:00Z"), 0, "Asia/Tokyo");
eq("W12 another zone keeps its own wall clock", [w.start.toISOString(), w.end.toISOString()], ["2026-10-16T09:00:00.000Z", "2026-10-18T13:00:00.000Z"]);
eq("W13 zonedTime on its own", W.zonedTime({ y: 2026, m: 10, d: 16 }, 18, 0, TZ).toISOString(), "2026-10-16T23:00:00.000Z");

// ---- words and highlighting
eq("K1 whole words only (no 'part' inside 'apartment')", W.matchedWords("Tenant at the apartment, partial repair", ["part", "parts"]), []);
eq("K1b nor inside the end of a word ('depart', 'counterpart')", W.matchedWords("will depart soon, a counterpart called", ["part"]), []);
eq("K2 found in any case, in the order of the list", W.matchedWords("NEEDS a new Part. Will order it.", ["part", "order", "needs"]), ["part", "order", "needs"]);
eq("K3 phrases with any spacing", W.matchedWords("customer should call   back tomorrow", ["call back"]), ["call back"]);
eq("K4 curly and straight apostrophes both match", [W.matchedWords("couldn’t open", ["couldn't"]), W.matchedWords("couldn't open", ["couldn't"])], [["couldn't"], ["couldn't"]]);
eq("K5 hyphenated phrases", W.matchedWords("needs follow-up visit", ["follow-up"]), ["follow-up"]);
eq("K6 special characters in a word cannot break the search", W.matchedWords("price $5 (est.) ok", ["$5", "(est.)", "a|b", "["]), ["$5", "(est.)"]);
eq("K7 no words, or empty text, finds nothing", [W.matchedWords("parts", []), W.matchedWords("", ["parts"])], [[], []]);
eq("K8 highlight cuts the text into pieces", W.highlightParts("Needs a part, ordered it", ["part", "needs", "ordered"]), [{ text: "Needs", hit: true }, { text: " a ", hit: false }, { text: "part", hit: true }, { text: ", ", hit: false }, { text: "ordered", hit: true }, { text: " it", hit: false }]);
eq("K9 the longer phrase wins over a shorter word inside it", W.highlightParts("will need a part", ["need", "will need"]).filter((p) => p.hit).map((p) => p.text), ["will need"]);
eq("K10 nothing to highlight returns the text as one piece", [W.highlightParts("all good", ["part"]), W.highlightParts("x", [])], [[{ text: "all good", hit: false }], [{ text: "x", hit: false }]]);
eq("K11 pieces always add back up to the original text", W.highlightParts("a part and a PART and part.", ["part"]).map((p) => p.text).join(""), "a part and a PART and part.");
eq("K11b words right next to each other, at the very start, and at the very end are all found", W.highlightParts("part part, order", ["part", "order"]).filter((x) => x.hit).map((x) => x.text), ["part", "part", "order"]);
eq("K11c a word at the very start", W.matchedWords("Parts needed", ["parts"]), ["parts"]);
eq("K12 settings: default list; custom list cleaned; junk falls back", [W.readRecapRules({}, true).words === W.DEFAULT_WORDS, W.readRecapRules({ WEEKEND_RECAP_WORDS: " Spring , ,x, motor  board ,spring" }, true).words, W.readRecapRules({ WEEKEND_RECAP_WORDS: "x, ," }, true).words === W.DEFAULT_WORDS], [true, ["spring", "motor board"], true]);
eq("K13 notes switch carries through", W.readRecapRules({}, false).showNotes, false);
ok("K14 the default list has the words the user named (parts, order, return, quote, estimate)", ["parts", "order", "return", "quote", "estimate"].every((x) => W.DEFAULT_WORDS.includes(x)));

// ---- notes
eq("N1 notes in several shapes, oldest first", W.recapNotes([{ id: "1", content: "first" }, "second", { text: "third" }, { nope: 1 }, null]), ["first", "second", "third"]);
eq("N2 spacing tidied, line breaks kept", W.recapNotes(["a   b\n\n  c"]), ["a b\nc"]);
eq("N3 a long note is cut at 1000 characters", W.recapNotes(["x".repeat(1500)])[0].length, 1003);
eq("N4 only the newest eight are kept", W.recapNotes(Array.from({ length: 12 }, (_, i) => `n${i}`)), ["n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11"]);
eq("N5 junk is nothing", [W.recapNotes(undefined), W.recapNotes(5), W.recapNotes({}), W.recapNotes([])], [[], [], [], []]);
ok("N6 the total stays under 4000 characters", W.recapNotes(Array.from({ length: 8 }, () => "y".repeat(900))).join("").length <= 4000);

// ---- evaluating jobs
const NOW = at("2026-10-19T14:00:00Z"); // Monday 9 AM
const win = W.weekendWindow(NOW, 0, TZ);
const helpers = { timeZone: () => TZ, isCanceled: (j: any) => !!j.canceled_at, classify: (j: any) => (/install/i.test(JSON.stringify(j.tags ?? "")) ? "install" : "service"), label: (j: any, k: string) => `${k === "install" ? "Install" : "Repair"} #${j.invoice_number}`, url: (id: string) => `https://pro.housecallpro.com/app/jobs/${id}`, techNames: (j: any, n: Map<string, string>) => (j.assigned_employees ?? []).map((e: any) => n.get(e.id) ?? "?") };
const names = new Map([["e1", "Josh Bayliss"], ["e2", "Kris Taylor"]]);
const job = (id: string, over: any = {}) => ({ id, invoice_number: id.replace("job_", ""), work_status: "complete rated", assigned_employees: [{ id: "e1" }], schedule: { scheduled_start: "2026-10-17T15:00:00Z" }, work_timestamps: { started_at: "2026-10-17T15:10:00Z", completed_at: "2026-10-17T16:00:00Z" }, notes: [{ id: "n", content: "job complete" }], ...over });
const rules = { words: W.DEFAULT_WORDS, showNotes: true };
const run = (jobs: any[], r = rules, now = NOW) => W.evaluateRecap(jobs, names, W.weekendWindow(now, 0, TZ), now, r, helpers);

let r = run([job("job_1")]);
eq("E1 a plain finished job with a note is listed but needs nothing", [r.items.length, r.items[0].state, r.items[0].needsLook, r.items[0].reasons, r.items[0].techs, r.items[0].label, r.items[0].minutesOnJob], [1, "finished", false, [], ["Josh Bayliss"], "Repair #1", 50]);
eq("E2 'when' is the finish time in business time", r.items[0].whenLabel, "Sat 11:00 AM");
eq("E3 the link is carried", r.items[0].url, "https://pro.housecallpro.com/app/jobs/job_1");
r = run([job("job_2", { notes: [{ content: "Needs a new spring, will order part Monday" }] })]);
eq("E4 notes with the flagged words need a look, and show which", [r.items[0].needsLook, r.items[0].reasons, r.items[0].words], [true, ["words"], ["part", "order", "needs"]]);
r = run([job("job_3", { notes: [] })]);
eq("E5 a finished job with no notes is flagged", [r.items[0].needsLook, r.items[0].reasons], [true, ["no-notes"]]);
r = run([job("job_4", { notes: undefined })]);
eq("E6 a finished job whose notes were never read is flagged too", r.items[0].reasons, ["no-notes"]);
r = run([job("job_5", { work_status: "in progress", work_timestamps: { started_at: "2026-10-17T15:10:00Z" }, notes: [] })]);
eq("E7 still 'in progress' a day and a half later: flagged as not finished (and not as 'no notes')", [r.items[0].state, r.items[0].reasons], ["in-progress", ["unfinished"]]);
r = run([job("job_6", { work_status: "in progress", work_timestamps: { started_at: "2026-10-19T01:00:00Z" }, schedule: { scheduled_start: "2026-10-19T01:00:00Z" } })], rules, at("2026-10-19T03:00:00Z"));
eq("E8 in progress for under six hours (Sunday 10 PM) is not flagged", r.items.length === 1 ? [r.items[0].state, r.items[0].reasons] : r.items.length, ["in-progress", []]);
r = run([job("job_7", { work_status: "scheduled", work_timestamps: {}, notes: [] })]);
eq("E9 scheduled in the window, time passed, never started: flagged", [r.items[0].state, r.items[0].reasons], ["not-started", ["unfinished"]]);
r = run([job("job_7b", { work_status: "scheduled", work_timestamps: {}, schedule: { scheduled_start: "2026-10-19T02:00:00Z" } })], rules, at("2026-10-19T01:00:00Z"));
eq("E10 a visit that is still ahead is 'upcoming' and not flagged", [r.items[0].state, r.items[0].reasons], ["upcoming", []]);
eq("E11 canceled jobs are left out", run([job("job_8", { canceled_at: "2026-10-17T00:00:00Z" })]).items.length, 0);
eq("E12 a weekday job (Thursday) is left out", run([job("job_9", { schedule: { scheduled_start: "2026-10-15T15:00:00Z" }, work_timestamps: { started_at: "2026-10-15T15:10:00Z", completed_at: "2026-10-15T16:00:00Z" } })]).items.length, 0);
eq("E13 Friday before 6 PM is out, Friday 6:30 PM is in", [run([job("a", { schedule: { scheduled_start: "2026-10-16T21:00:00Z" }, work_timestamps: { started_at: "2026-10-16T21:10:00Z", completed_at: "2026-10-16T22:00:00Z" } })]).items.length, run([job("b", { schedule: { scheduled_start: "2026-10-16T23:30:00Z" }, work_timestamps: { started_at: "2026-10-16T23:35:00Z", completed_at: "2026-10-17T00:30:00Z" } })]).items.length], [0, 1]);
eq("E14 Sunday 10:30 PM is out, Sunday 9:30 PM is in", [run([job("c", { schedule: { scheduled_start: "2026-10-19T03:30:00Z" }, work_timestamps: { started_at: "2026-10-19T03:35:00Z", completed_at: "2026-10-19T04:00:00Z" } })]).items.length, run([job("d", { schedule: { scheduled_start: "2026-10-19T02:30:00Z" }, work_timestamps: { started_at: "2026-10-19T02:35:00Z", completed_at: "2026-10-19T02:55:00Z" } })]).items.length], [0, 1]);
eq("E15 a job that began Friday afternoon but finished after 6 PM is in (by its finish)", run([job("e", { schedule: { scheduled_start: "2026-10-16T20:00:00Z" }, work_timestamps: { started_at: "2026-10-16T20:10:00Z", completed_at: "2026-10-17T00:10:00Z" } })]).items.length, 1);
eq("E16 the same job twice shows once", run([job("job_1"), job("job_1")]).items.length, 1);
eq("E17 junk entries are ignored", run([null, {}, { id: 5 }, job("job_1")] as any).items.length, 1);
eq("E18 several techs are all named", run([job("job_m", { assigned_employees: [{ id: "e1" }, { id: "e2" }] })]).items[0].techs, ["Josh Bayliss", "Kris Taylor"]);
r = run([job("job_n1", { notes: [{ content: "all done" }] }), job("job_n2", { notes: [{ content: "need a part" }], work_timestamps: { started_at: "2026-10-18T15:00:00Z", completed_at: "2026-10-18T16:00:00Z" }, schedule: { scheduled_start: "2026-10-18T15:00:00Z" } }), job("job_n3", { notes: [], work_timestamps: { started_at: "2026-10-17T20:00:00Z", completed_at: "2026-10-17T21:00:00Z" }, schedule: { scheduled_start: "2026-10-17T20:00:00Z" } })]);
eq("E19 flagged jobs come first, each group oldest to newest", r.items.map((i) => i.id), ["job_n3", "job_n2", "job_n1"]);
eq("E20 the counts", r.counts, { total: 3, finished: 3, needsLook: 2, withWords: 1, noNotes: 1, unfinished: 0 });
r = run([job("job_o", { notes: [{ content: "need a part" }] })], { words: W.DEFAULT_WORDS, showNotes: false });
eq("E21 with notes turned off: jobs listed, notes empty, nothing flagged by words or 'no notes'", [r.items[0].notes, r.items[0].reasons], [[], []]);
r = run([job("job_p", { notes: [{ content: "Replaced the spring" }] })], { words: ["spring"], showNotes: true });
eq("E22 a custom word list is used instead of the default", r.items[0].words, ["spring"]);
const many = Array.from({ length: 250 }, (_, i) => job(`job_${1000 + i}`));
r = run(many);
eq("E23 a very busy weekend is capped at 200 but counted in full", [r.items.length, r.counts.total], [200, 250]);

// ---- reading from Housecall Pro
function fakeApi(jobs: any[], opts: any = {}) {
  const calls: any = { list: [] as any[], get: [] as string[] };
  return { calls, listEmployees: async () => [], getJob: async (id: string) => { calls.get.push(id); if (opts.getFails) throw new Error("boom"); return { id, notes: [{ content: `full notes for ${id}: need parts` }] }; }, listAppointments: async () => [], listEvents: async () => [], async *listJobsInWindow(from: Date, to: Date) { calls.list.push([from.toISOString(), to.toISOString()]); if (opts.listFails) throw new Error(opts.listFails); const size = opts.pageSize ?? 2; for (let i = 0; i < jobs.length; i += size) yield { jobs: jobs.slice(i, i + size), page: 1, totalPages: 1, totalItems: jobs.length }; } } as any;
}
const live = { ...helpers, employeeNames: async () => names, describeError: (e: any) => ({ category: "Housecall Pro said no", detail: String(e?.message) }) };
W.resetWeekendRecapCache();
let api = fakeApi([job("job_1"), job("job_2", { notes: undefined }), job("job_3", { notes: [] })], { pageSize: 1 });
let res: any = await W.getWeekendRecap({ api, helpers: live, rules, now: () => NOW });
eq("R1 reads every page, asks from a day before the window opens to its end", [res.ok, res.counts.total, api.calls.list], [true, 3, [["2026-10-15T23:00:00.000Z", "2026-10-19T03:00:00.000Z"]]]);
eq("R2 a job whose notes were missing from the list is read once for its notes", [api.calls.get, res.items.find((i: any) => i.id === "job_2").words], [["job_2"], ["parts", "need"]]);
eq("R3 an answer with the window, words and counts the page needs", [res.window.label, res.window.isCurrent, res.window.back, res.notesHidden, res.words === W.DEFAULT_WORDS], ["Fri, Oct 16, 6 PM to Sun, Oct 18, 10 PM", false, 0, false, true]);
await W.getWeekendRecap({ api, helpers: live, rules, now: () => new Date(NOW.getTime() + 60_000) });
eq("R4 asked again within five minutes: no new request", api.calls.list.length, 1);
await W.getWeekendRecap({ api, helpers: live, rules, now: () => new Date(NOW.getTime() + 6 * 60_000) });
eq("R5 after five minutes it asks again (notes read before are not re-read)", [api.calls.list.length, api.calls.get.length], [2, 1]);
await W.getWeekendRecap({ api, helpers: live, rules, now: () => new Date(NOW.getTime() + 6 * 60_000 + 1000), fresh: true });
eq("R6 fresh=true skips the cache", api.calls.list.length, 3);
await W.getWeekendRecap({ api, helpers: live, rules, back: 1, now: () => NOW });
eq("R7 each weekend is cached on its own", api.calls.list.length, 4);
W.resetWeekendRecapCache();
api = fakeApi([job("job_1")]);
const both = await Promise.all([1, 2, 3].map(() => W.getWeekendRecap({ api, helpers: live, rules, now: () => NOW })));
eq("R8 callers at the same moment share one request", [api.calls.list.length, both.every((x: any) => x === both[0])], [1, true]);
W.resetWeekendRecapCache();
api = fakeApi([job("job_1")], { listFails: "HCP down" });
res = await W.getWeekendRecap({ api, helpers: live, rules, now: () => NOW });
eq("R9 a failure is a plain-English message, never a crash", [res.ok, res.error], [false, "Could not check: Housecall Pro said no."]);
await W.getWeekendRecap({ api, helpers: live, rules, now: () => new Date(NOW.getTime() + 20_000) });
eq("R10 a failure is retried after 15 seconds, not five minutes", api.calls.list.length, 2);
W.resetWeekendRecapCache();
api = fakeApi([job("job_1")], { listFails: "HCP_API_KEY is not set" });
res = await W.getWeekendRecap({ api, helpers: live, rules, now: () => NOW });
eq("R11 'not connected' says so", res.error, "Housecall Pro is not connected yet (HCP_API_KEY is empty).");
W.resetWeekendRecapCache();
api = fakeApi([job("job_2", { notes: undefined })], { getFails: true });
res = await W.getWeekendRecap({ api, helpers: live, rules, now: () => NOW });
eq("R12 if reading a job's notes fails, the job still shows (as 'no notes') and the recap works", [res.ok, res.items[0].reasons], [true, ["no-notes"]]);
W.resetWeekendRecapCache();
api = fakeApi(Array.from({ length: 40 }, (_, i) => job(`job_${i}`, { notes: undefined })), { pageSize: 100 });
res = await W.getWeekendRecap({ api, helpers: live, rules, now: () => NOW });
eq("R13 at most 25 job records are read for notes per check", api.calls.get.length, 25);
W.resetWeekendRecapCache();
api = fakeApi([job("job_1", { notes: undefined })]);
res = await W.getWeekendRecap({ api, helpers: live, rules: { words: rules.words, showNotes: false }, now: () => NOW });
eq("R14 with notes off, no job records are read and notes are hidden", [api.calls.get.length, res.notesHidden, res.items[0].notes], [0, true, []]);
let sawPages = 0; api = fakeApi(Array.from({ length: 1500 }, (_, i) => job(`job_${i}`)), { pageSize: 100 });
W.resetWeekendRecapCache(); res = await W.getWeekendRecap({ api, helpers: live, rules: { words: rules.words, showNotes: true }, now: () => NOW });
eq("R15 never reads more than ten pages", res.counts.total, 1000);

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
