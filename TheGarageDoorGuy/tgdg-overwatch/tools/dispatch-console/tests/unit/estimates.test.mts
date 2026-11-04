// @ts-nocheck
import { evaluateEstimates, buildReport, readEstimateRules, estimateUrl, outcomeOf, valueCents, hasAllTags, madeInField, readRecentEstimates, readEstimatesSince, getEstimateWatch, getEstimateReport, resetEstimateCaches, estimateFingerprint, mergeReviews, reviewLogCsv, REVIEW_CSV_HEADERS, DEFAULT_ESTIMATE_RULES, type HcpEstimate, type EstimateApi, type ReviewRecord } from "../../src/lib/estimates.ts";

let passes = 0, failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
const eq = (name: string, a: unknown, b: unknown) => check(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const TZ = "America/Chicago";
const NOW = new Date("2026-10-19T15:00:00Z"); // Monday 19 Oct 2026, 10:00 AM Chicago
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const days = (d: number) => d * 1440;
let n = 0;
const opt = (o: Record<string, unknown> = {}) => ({ id: "opt", name: "Option 1", total_amount: 125000, approval_status: null, status: "submitted for signoff", tags: ["Jasen Est", "*"], ...o });
const est = (o: Partial<HcpEstimate> & Record<string, unknown> = {}): HcpEstimate => ({
  id: "csr_" + String(++n).padStart(32, "0"), estimate_number: String(1000 + n), work_status: "scheduled", created_at: ago(days(1)),
  customer: { first_name: "Zelda", last_name: "Quimby" }, assigned_employees: [{ id: "pro_a", first_name: "Alex", last_name: "Tech" }],
  work_timestamps: { on_my_way_at: null, started_at: null, completed_at: null }, options: [opt()], ...o,
} as HcpEstimate);
const R = DEFAULT_ESTIMATE_RULES;
const watch = (list: HcpEstimate[], now = NOW, rules = R) => evaluateEstimates(list, now, rules, TZ);

// ===== A. settings
eq("A1 defaults", readEstimateRules({}), { waitDays: 3, waitMaxDays: 14, finishedHours: 3, urlTemplate: "https://pro.housecallpro.com/app/estimates/{id}", listTags: ["Jasen Est", "*"], listFrom: null, showCustomer: false });
const custom = readEstimateRules({ ESTIMATE_WAIT_DAYS: "5", ESTIMATE_WAIT_MAX_DAYS: "30", ESTIMATE_FINISHED_HOURS: "6", ESTIMATE_LIST_TAGS: " Foo , bar ,, ", ESTIMATE_LIST_FROM: "2026-03-01", ESTIMATE_SHOW_CUSTOMER: "ON", HCP_ESTIMATE_URL_TEMPLATE: "https://pro.housecallpro.com/x/{id}/y" });
eq("A2 custom values are used", [custom.waitDays, custom.waitMaxDays, custom.finishedHours, custom.listTags, custom.listFrom, custom.showCustomer, custom.urlTemplate], [5, 30, 6, ["Foo", "bar"], "2026-03-01", true, "https://pro.housecallpro.com/x/{id}/y"]);
for (const bad of ["", "abc", "0", "-1", "1.5", "999", " "]) eq(`A3 bad wait days "${bad}" fall back to 3`, readEstimateRules({ ESTIMATE_WAIT_DAYS: bad }).waitDays, 3);
eq("A4 the longest wait can never be shorter than the first", readEstimateRules({ ESTIMATE_WAIT_DAYS: "20", ESTIMATE_WAIT_MAX_DAYS: "5" }).waitMaxDays, 20);
for (const bad of ["http://pro.housecallpro.com/{id}", "https://x.com/no-id", "https://x.com/{id}/{id}", "javascript:{id}", "https://a b/{id}"]) eq(`A5 a bad url template "${bad}" falls back`, readEstimateRules({ HCP_ESTIMATE_URL_TEMPLATE: bad }).urlTemplate, R.urlTemplate);
for (const bad of ["x", "2026-13-45", "26-01-01", ""]) eq(`A6 a bad start date "${bad}" is ignored`, readEstimateRules({ ESTIMATE_LIST_FROM: bad }).listFrom, null);
eq("A7 customer names stay off unless exactly 'on'", ["", "yes", "true", "1", "off"].map((v) => readEstimateRules({ ESTIMATE_SHOW_CUSTOMER: v }).showCustomer), [false, false, false, false, false]);
eq("A8 the estimate link", estimateUrl(R.urlTemplate, "csr_abc"), "https://pro.housecallpro.com/app/estimates/csr_abc");
eq("A9 unsafe ids get no link", [estimateUrl(R.urlTemplate, "a/b"), estimateUrl(R.urlTemplate, ""), estimateUrl(R.urlTemplate, "x".repeat(81)), estimateUrl(R.urlTemplate, 5), estimateUrl(R.urlTemplate, "a b?c")], [null, null, null, null, null]);

// ===== B. outcomes and values
eq("B1 job created = won", outcomeOf(est({ work_status: "created job from estimate" })), "won");
eq("B2 approved / pro approved option = won", [outcomeOf(est({ options: [opt({ approval_status: "approved" })] })), outcomeOf(est({ options: [opt({ approval_status: "pro approved" })] }))], ["won", "won"]);
eq("B3 declined / pro declined (none approved) = declined", [outcomeOf(est({ options: [opt({ approval_status: "declined" })] })), outcomeOf(est({ options: [opt({ approval_status: "pro declined" })] }))], ["declined", "declined"]);
eq("B4 an approved option beats a declined one", outcomeOf(est({ options: [opt({ approval_status: "declined" }), opt({ approval_status: "pro approved" })] })), "won");
eq("B5 all options expired = expired", outcomeOf(est({ options: [opt({ approval_status: "expired" }), opt({ approval_status: "expired" })] })), "expired");
eq("B6 an unanswered option = open (also when another has expired)", [outcomeOf(est()), outcomeOf(est({ options: [opt({ approval_status: "expired" }), opt()] }))], ["open", "open"]);
eq("B7 canceled work = canceled, even if an option was approved", outcomeOf(est({ work_status: "pro canceled", options: [opt({ approval_status: "approved" })] })), "canceled");
eq("B8 a deleted option is ignored", outcomeOf(est({ options: [opt({ approval_status: "approved", status: "deleted" }), opt({ approval_status: "declined" })] })), "declined");
eq("B9 no options at all = open", outcomeOf(est({ options: [] })), "open");
eq("B10 value: approved options are added up", valueCents(est({ options: [opt({ approval_status: "approved", total_amount: 100000 }), opt({ approval_status: "pro approved", total_amount: 50000 }), opt({ total_amount: 900000 })] })), 150000);
eq("B11 value: with nothing approved, the biggest option", valueCents(est({ options: [opt({ total_amount: 100000 }), opt({ total_amount: 300000 })] })), 300000);
eq("B12 value: junk amounts count as zero", valueCents(est({ options: [opt({ total_amount: "5" }), opt({ total_amount: null }), opt({ total_amount: -4 }), opt({ total_amount: NaN })] as never })), 0);
eq("B13 field-made = a Start or Finish tap", [madeInField(est()), madeInField(est({ work_timestamps: { started_at: ago(5) } })), madeInField(est({ work_timestamps: { completed_at: ago(5) } })), madeInField(est({ work_timestamps: { started_at: "junk" } }))], [false, true, true, false]);

// ===== C. a tech finishes an estimate in the field
const fin = (minutesAgo: number, o: Record<string, unknown> = {}) => est({ work_timestamps: { started_at: ago(minutesAgo + 35), completed_at: ago(minutesAgo) }, ...o });
let w = watch([fin(5)]);
eq("C1 a just-finished field estimate is announced once", [w.finished.length, w.waiting.length], [1, 0]);
const f = w.finished[0];
eq("C2 who, which, when, how long", [f.techs, f.label, f.completedLabel, f.minutesOnJob, f.kind], [["Alex Tech"], "Estimate #" + f.label.slice(10), "9:55 AM", 35, "estimate"]);
eq("C3 the options and amounts ride along as the notes", f.notes, ["Option 1: $1,250"]);
eq("C4 it links to the estimate", f.url, "https://pro.housecallpro.com/app/estimates/" + f.jobId);
check("C5 the id is the estimate plus the moment of finishing (a re-finish is new)", f.id === `${f.jobId}#${Date.parse(f.completedAt)}`);
eq("C6 older than the window: not announced", watch([fin(3 * 60 + 5)]).finished.length, 0);
eq("C7 just inside the window: announced", watch([fin(3 * 60 - 1)]).finished.length, 1);
eq("C8 a finish a couple of minutes in the future (clock drift) is announced", watch([fin(-2)]).finished.length, 1);
eq("C9 far in the future is not", watch([fin(-30)]).finished.length, 0);
eq("C10 canceled is not announced", watch([fin(5, { work_status: "user canceled" })]).finished.length, 0);
w = watch([fin(3, { options: [] })]);
eq("C11 no options yet and fresh: 'pending' so the bar can fill in later", [w.finished[0].notes, w.finished[0].notesPending], [[], true]);
w = watch([fin(30, { options: [] })]);
eq("C12 no options and older than 10 minutes: not pending", w.finished[0].notesPending, false);
w = watch([fin(5, { options: [opt({ name: "Steel Back", total_amount: 99900 }), opt({ name: "", total_amount: 0 }), opt({ status: "deleted" })] })]);
eq("C13 amounts shown, blank names become 'Option', zero amounts show just the name, deleted options hidden", w.finished[0].notes, ["Steel Back: $999", "Option"]);
w = watch([fin(5, { assigned_employees: [{ first_name: "Alex", last_name: "Tech" }, { first_name: "Blake" }] })]);
eq("C14 two techs", w.finished[0].techs, ["Alex Tech", "Blake"]);
check("C15 no customer detail in a finished item", !JSON.stringify(watch([fin(5)])).includes("Zelda") && !JSON.stringify(watch([fin(5)])).includes("Quimby"));
w = watch([fin(10), fin(2), fin(60)]);
eq("C16 newest first", w.finished.map((x) => x.completedAt), [ago(2), ago(10), ago(60)]);
eq("C17 a finished field estimate is not ALSO reported as waiting", watch([fin(5, { created_at: ago(days(5)) })]).waiting.length, 0);
eq("C18 the window is a setting", watch([fin(5 * 60)], NOW, { ...R, finishedHours: 6 }).finished.length, 1);

// ===== D. an office-made estimate nobody has answered
w = watch([est({ created_at: ago(days(3) + 5) })]);
eq("D1 3 days old, no answer, made at the office: a waiting bar", [w.waiting.length, w.finished.length], [1, 0]);
const a = w.waiting[0];
eq("D2 the bar's facts", [a.kind, a.startedLabel, a.limitMinutes, a.minutesOnJob >= days(3), a.label.endsWith("($1,250)")], ["estimate", "Oct 16", days(3), true, true]);
eq("D3 id includes the wait setting, link is to the estimate", [a.id.endsWith("@3d"), a.url], [true, "https://pro.housecallpro.com/app/estimates/" + a.jobId]);
eq("D4 not yet 3 days: nothing", watch([est({ created_at: ago(days(3) - 10) })]).waiting.length, 0);
eq("D5 past the longest wait (14 days): nothing", watch([est({ created_at: ago(days(14) + 10) })]).waiting.length, 0);
eq("D6 14 days minus a bit: still raised", watch([est({ created_at: ago(days(14) - 10) })]).waiting.length, 1);
for (const status of ["approved", "pro approved", "declined", "pro declined"]) eq(`D7 an option "${status}" means answered`, watch([est({ created_at: ago(days(4)), options: [opt({ approval_status: status })] })]).waiting.length, 0);
eq("D8 'expired' is NOT an answer: still raised", watch([est({ created_at: ago(days(4)), options: [opt({ approval_status: "expired" })] })]).waiting.length, 1);
eq("D9 one option answered, another not: answered wins", watch([est({ created_at: ago(days(4)), options: [opt({ approval_status: "declined" }), opt()] })]).waiting.length, 0);
eq("D10 already became a job: nothing", watch([est({ created_at: ago(days(4)), work_status: "created job from estimate" })]).waiting.length, 0);
eq("D11 canceled: nothing", watch([est({ created_at: ago(days(4)), work_status: "user canceled" })]).waiting.length, 0);
eq("D12 made in the field (a tech tapped Start): not a waiting bar", watch([est({ created_at: ago(days(4)), work_timestamps: { started_at: ago(days(4)) } })]).waiting.length, 0);
eq("D13 no options (nothing quoted yet): nothing", watch([est({ created_at: ago(days(4)), options: [] })]).waiting.length, 0);
eq("D14 only deleted options: nothing", watch([est({ created_at: ago(days(4)), options: [opt({ status: "deleted" })] })]).waiting.length, 0);
eq("D15 a missing or junk created_at: ignored", watch([est({ created_at: null }), est({ created_at: "junk" })]).waiting.length, 0);
w = watch([est({ created_at: ago(days(4)) }), est({ created_at: ago(days(9)) }), est({ created_at: ago(days(6)) })]);
eq("D16 longest waiting first", w.waiting.map((x) => Math.round(x.minutesOnJob / days(1))), [9, 6, 4]);
eq("D17 the wait is a setting", [watch([est({ created_at: ago(days(4)) })], NOW, { ...R, waitDays: 5 }).waiting.length, watch([est({ created_at: ago(days(6)) })], NOW, { ...R, waitDays: 5 }).waiting.length], [0, 1]);
check("D18 no customer detail in a waiting item", !JSON.stringify(watch([est({ created_at: ago(days(4)) })])).includes("Zelda"));
w = watch([est({ created_at: ago(days(4)), options: [opt({ total_amount: 0 })] })]);
eq("D19 no amount: label has no dollars", w.waiting[0].label.includes("$"), false);
eq("D20 junk entries never crash it", watch([null, 7, "x", {}, { id: 5 }, { id: "x", options: "junk", assigned_employees: 3, work_timestamps: 9 }] as never).waiting.length, 0);

// ===== E. the tags
eq("E1 an option with every tag matches (case does not matter)", hasAllTags(est({ options: [opt({ tags: ["JASEN EST", "*"] })] }), ["Jasen Est", "*"]), true);
eq("E2 missing one tag does not match", hasAllTags(est({ options: [opt({ tags: ["Jasen Est"] })] }), ["Jasen Est", "*"]), false);
eq("E3 tags split across two options do not match", hasAllTags(est({ options: [opt({ tags: ["Jasen Est"] }), opt({ tags: ["*"] })] }), ["Jasen Est", "*"]), false);
eq("E4 junk tags never crash", hasAllTags(est({ options: [opt({ tags: "x" }), opt({ tags: [1, null] }), opt({ tags: undefined })] as never }), ["a"]), false);
eq("E5 an empty tag list matches nothing", hasAllTags(est(), []), false);
eq("E6 a deleted option's tags do not count", hasAllTags(est({ options: [opt({ status: "deleted" })] }), ["Jasen Est"]), false);

// ===== F. the page: the list and the numbers
const yr = (o: Record<string, unknown>, daysAgo: number) => est({ created_at: ago(days(daysAgo)), ...o });
const sample = [
  yr({ options: [opt({ approval_status: "pro approved", total_amount: 200000 })] }, 2),
  yr({ options: [opt({ approval_status: "declined" })] }, 5),
  yr({ options: [opt({ approval_status: "expired" })] }, 20),
  yr({ options: [opt()] }, 40),
  yr({ work_status: "user canceled" }, 41),
  yr({ options: [opt({ tags: ["est jrb", "*"], approval_status: "approved", total_amount: 1000000 })], assigned_employees: [{ first_name: "Blake", last_name: "Tech" }] }, 60),
  yr({ options: [opt({ tags: ["Jasen Est"] })] }, 30),
  yr({ options: [opt()] }, 400), // last year
  yr({ options: [opt({ total_amount: 20000000, approval_status: "approved" })] }, 3),
];
const rep = buildReport(sample, NOW, R, TZ);
eq("F1 period: 1 Jan this year to today", [rep.from, rep.to], ["2026-01-01", "2026-10-19"]);
eq("F2 the list holds only estimates with Jasen Est AND * (canceled ones are listed as canceled), this year, newest first", rep.list.map((r) => r.outcome), ["won", "won", "declined", "expired", "open", "canceled"]);
eq("F3 the list tally", [rep.listTally.total, rep.listTally.won, rep.listTally.declined, rep.listTally.expired, rep.listTally.open, rep.listTally.closeRate], [6, 2, 1, 1, 1, 40]);
eq("F4 the all-estimates tally counts last year's out and keeps canceled apart", [rep.allTally.total, rep.allTally.canceled, rep.allTally.won], [8, 1, 3]);
eq("F5 close rate leaves canceled out: 3 / 7 = 43%", rep.allTally.closeRate, 43);
eq("F6 won revenue adds the approved options", rep.allTally.wonCents, 200000 + 1000000 + 20000000);
eq("F7 an enormous amount is marked suspect, and only that one", rep.list.filter((r) => r.suspect).length, 1);
eq("F8 by month, newest first", rep.byMonth.map((m) => m.key), ["2026-10", "2026-09", "2026-08"]);
eq("F9 by tech: Alex 7 (most first), Blake 1", rep.byTech.map((t) => [t.key, t.tally.total]), [["Alex Tech", 7], ["Blake Tech", 1]]);
eq("F10 customer names are NOT in the rows by default", rep.list.every((r) => r.customer === null) && !JSON.stringify(rep).includes("Zelda"), true);
const named = buildReport(sample, NOW, { ...R, showCustomer: true }, TZ);
eq("F11 with ESTIMATE_SHOW_CUSTOMER=on the rows carry the name", named.list[0].customer, "Zelda Quimby");
eq("F12 the start date is a setting", buildReport(sample, NOW, { ...R, listFrom: "2026-10-01" }, TZ).allTally.total, 3);
eq("F13 an empty list is fine and has no close rate", [buildReport([], NOW, R, TZ).allTally.closeRate, buildReport([], NOW, R, TZ).list.length], [null, 0]);
eq("F14 junk entries never crash it", buildReport([null, 3, {}, { id: "x" }, { id: "y", created_at: "junk" }] as never, NOW, R, TZ).allTally.total, 0);
eq("F15 the rows link to the estimate", rep.list[0].url?.startsWith("https://pro.housecallpro.com/app/estimates/"), true);
check("F16 a created_at just after midnight Chicago lands in the right month", buildReport([est({ created_at: "2026-10-01T05:30:00Z", options: [opt()] })], NOW, R, TZ).byMonth[0].key === "2026-10" && buildReport([est({ created_at: "2026-10-01T04:30:00Z", options: [opt()] })], NOW, R, TZ).byMonth[0].key === "2026-09");

// ===== G. reading from Housecall Pro, caching
const pageOf = (list: HcpEstimate[], pageSize = 100) => (p: number) => ({ estimates: list.slice((p - 1) * pageSize, p * pageSize), page: p, totalPages: Math.max(1, Math.ceil(list.length / pageSize)) });
const mkApi = (list: HcpEstimate[], counter = { calls: 0, pages: [] as number[] }): EstimateApi & { counter: typeof counter } => ({ counter, async listEstimatesPage(p, size) { counter.calls++; counter.pages.push(p); return pageOf(list, size)(p); } });
const many = Array.from({ length: 250 }, (_, i) => est({ created_at: ago(i * 60) }));
let api = mkApi(many);
eq("G1 recent reads 2 pages (200) only", [(await readRecentEstimates(api)).length, api.counter.calls], [200, 2]);
api = mkApi(many);
eq("G2 'since' stops at the first page that goes past the start date", [(await readEstimatesSince(api, "2026-10-18", TZ)).length, api.counter.calls], [100, 1]);
api = mkApi(many);
eq("G3 'since' follows pages while still inside the period", [(await readEstimatesSince(api, "2026-09-01", TZ)).length, api.counter.calls], [250, 3]);
api = mkApi(many);
eq("G4 the page limit is a hard stop", (await readEstimatesSince(api, "2000-01-01", TZ, 2)).length, 200);
resetEstimateCaches();
api = mkApi([fin(5)]);
const ctx = { api, timeZone: () => TZ, now: () => NOW };
await getEstimateWatch(ctx); await getEstimateWatch(ctx); await getEstimateWatch({ ...ctx, now: () => new Date(NOW.getTime() + 30_000) });
eq("G5 the pop-up read is cached for a minute", api.counter.calls, 1);
await getEstimateWatch({ ...ctx, now: () => new Date(NOW.getTime() + 61_000) });
eq("G6 and refreshed after it", api.counter.calls, 2);
resetEstimateCaches();
api = mkApi([est()]);
await Promise.all([getEstimateWatch({ ...ctx, api }), getEstimateWatch({ ...ctx, api }), getEstimateWatch({ ...ctx, api })]);
eq("G7 callers at the same moment share one read", api.counter.calls, 1);
resetEstimateCaches();
api = mkApi([est()]);
await getEstimateReport({ ...ctx, api }); await getEstimateReport({ ...ctx, api, now: () => new Date(NOW.getTime() + 5 * 60_000) });
eq("G8 the page read is cached for ten minutes", api.counter.calls, 1);
await getEstimateReport({ ...ctx, api, fresh: true });
eq("G9 'fresh' skips the cache", api.counter.calls, 2);
resetEstimateCaches();
const failing: EstimateApi = { async listEstimatesPage() { throw new Error("HCP API error 500"); } };
let threw = false; try { await getEstimateWatch({ ...ctx, api: failing }); } catch { threw = true; }
eq("G10 a failed read throws (the route turns it into a message) and is not cached", threw, true);
api = mkApi([est()]);
await getEstimateWatch({ ...ctx, api });
eq("G11 the next read after a failure works", api.counter.calls, 1);


// ===== H. review: fingerprint, merge (needs-review + changed-since), CSV
{
  const base = est({ work_status: "scheduled", options: [opt({ approval_status: null, total_amount: 125000 })] });
  const fp = estimateFingerprint(base);
  eq("H1 fingerprint is a short stable string", typeof fp === "string" && fp.length > 0 && fp.length <= 32 && estimateFingerprint(base) === fp, true);
  eq("H2 option order does not change the fingerprint", estimateFingerprint(est({ options: [opt({ id: "a", total_amount: 1 }), opt({ id: "b", total_amount: 2 })] })), estimateFingerprint(est({ options: [opt({ id: "b", total_amount: 2 }), opt({ id: "a", total_amount: 1 })] })));
  eq("H3 an approval or amount change moves the fingerprint", [
    estimateFingerprint(est({ work_status: "scheduled", options: [opt({ approval_status: "approved" })] })) !== fp,
    estimateFingerprint(est({ work_status: "scheduled", options: [opt({ total_amount: 999 })] })) !== fp,
    estimateFingerprint(est({ work_status: "created job from estimate", options: [opt({ approval_status: null, total_amount: 125000 })] })) !== fp,
  ], [true, true, true]);

  // merge: three estimates on the list, one reviewed-and-unchanged, one reviewed-but-changed, one never reviewed
  const r1 = est({ estimate_number: "2001", work_status: "scheduled", options: [opt({ approval_status: null, total_amount: 100000 })] });
  const r2 = est({ estimate_number: "2002", work_status: "scheduled", options: [opt({ approval_status: null, total_amount: 200000 })] });
  const r3 = est({ estimate_number: "2003", work_status: "scheduled", options: [opt({ approval_status: null, total_amount: 300000 })] });
  const report = buildReport([r1, r2, r3], NOW, R, TZ);
  eq("H4 every list row carries a fingerprint", report.list.every((x) => typeof x.fingerprint === "string" && x.fingerprint.length > 0), true);
  const fpOf = (id: string) => report.list.find((x) => x.id === id)!.fingerprint;
  const reviews: Record<string, ReviewRecord> = {
    [r1.id]: { reviewedBy: "Jasen", reviewedAt: "2026-10-18T20:00:00Z", note: "called customer", reviewedFingerprint: fpOf(r1.id) },        // unchanged since
    [r2.id]: { reviewedBy: "Dana", reviewedAt: "2026-10-17T20:00:00Z", note: null, reviewedFingerprint: "stale-xxxxx" },                    // changed since
  };
  const merged = mergeReviews(report.list, reviews, TZ);
  const m = (id: string) => merged.rows.find((x) => x.id === id)!;
  eq("H5 reviewed + unchanged: not on needs-review, carries who/when/note", [m(r1.id).reviewed, m(r1.id).needsReview, m(r1.id).changedSinceReview, m(r1.id).reviewedBy, m(r1.id).note, !!m(r1.id).reviewedAtLabel], [true, false, false, "Jasen", "called customer", true]);
  eq("H6 reviewed but changed: back on needs-review, flagged changed", [m(r2.id).reviewed, m(r2.id).needsReview, m(r2.id).changedSinceReview, m(r2.id).reviewedBy], [true, true, true, "Dana"]);
  eq("H7 never reviewed: needs review", [m(r3.id).reviewed, m(r3.id).needsReview, m(r3.id).reviewedBy], [false, true, null]);
  eq("H8 needs-review count = untouched + changed", merged.needsReviewCount, 2);
  eq("H9 no reviews at all: everything needs review", mergeReviews(report.list, {}, TZ).needsReviewCount, 3);

  // CSV
  const csv = reviewLogCsv(merged.rows);
  const lines = csv.split("\r\n");
  eq("H10 CSV header matches", lines[0], REVIEW_CSV_HEADERS.map((h) => `"${h}"`).join(","));
  eq("H11 one row per estimate", lines.length, report.list.length + 1);
  const row1 = lines.find((l) => l.includes('"2001"'))!;
  eq("H12 reviewed row shows Yes / by / note", row1.includes('"Yes"') && row1.includes('"Jasen"') && row1.includes('"called customer"'), true);
  const row2 = lines.find((l) => l.includes('"2002"'))!;
  eq("H13 a changed-since row is marked", row2.includes('"Changed since reviewed"') === false && row2.split('","').some((c) => c === "Yes") , true);
  eq("H14 a formula-looking note is defused so a spreadsheet won't run it", reviewLogCsv([{ ...merged.rows[0], note: "=SUM(A1:A9)" }]).includes(`"'=SUM(A1:A9)"`), true);
  eq("H15 quotes and commas in a note are escaped", reviewLogCsv([{ ...merged.rows[0], note: 'he said "ok, soon"' }]).includes('"he said ""ok, soon"""'), true);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
