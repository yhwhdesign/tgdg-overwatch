// The real route, through the real Housecall Pro client, against a stand-in Housecall Pro server. "Now" is pinned to
// Monday Oct 19 2026, 9 AM Central, so the weekend in question is Fri Oct 16 6 PM to Sun Oct 18 10 PM.
const esbuild = require("esbuild");
const http = require("http");
const path = require("path");
const fs = require("fs");
const SRC = path.join(__dirname, "../../src");
const NEXT = path.join(__dirname, "../../node_modules/next/server.js");
const TMP = path.join(__dirname, "..", ".tmp");
fs.mkdirSync(TMP, { recursive: true });
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
process.env.BUSINESS_TIMEZONE = "America/Chicago";

const RealDate = Date;
const FIXED = RealDate.parse("2026-10-19T14:00:00Z");
function pinTime(on) {
  if (!on) { globalThis.Date = RealDate; return; }
  globalThis.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } };
}

(async () => {
  const requests = [];
  let mode = "ok";
  const id = (c) => "job_" + c.repeat(32);
  const cust = { first_name: "Jane", last_name: "Customer", mobile_number: "501-555-0101", email: "jane@example.com" };
  const addr = { street: "12 Secret Ln", city: "Little Rock", zip: "72201" };
  const jobs = [
    { id: id("a"), invoice_number: 40883, work_status: "complete rated", assigned_employees: [{ id: "pro_a" }], schedule: { scheduled_start: "2026-10-17T15:00:00Z" }, work_timestamps: { started_at: "2026-10-17T15:10:00Z", completed_at: "2026-10-17T16:00:00Z" }, job_fields: { job_type: { name: "Repair" } }, notes: [{ id: "n1", content: "Replaced spring. Needs a quote for a new opener. Gate code 9999" }], customer: cust, address: addr, description: "Fix spring for Jane Customer" },
    { id: id("b"), invoice_number: 40891, work_status: "complete rated", assigned_employees: [{ id: "pro_b" }], schedule: { scheduled_start: "2026-10-18T16:00:00Z" }, work_timestamps: { started_at: "2026-10-18T16:05:00Z", completed_at: "2026-10-18T17:30:00Z" }, job_fields: { job_type: { name: "Repair" } }, customer: cust },
    { id: id("c"), invoice_number: 40892, work_status: "complete rated", assigned_employees: [{ id: "pro_a" }], schedule: { scheduled_start: "2026-10-18T18:00:00Z" }, work_timestamps: { started_at: "2026-10-18T18:05:00Z", completed_at: "2026-10-18T18:40:00Z" }, job_fields: { job_type: { name: "Repair" } }, notes: [] },
    { id: id("d"), invoice_number: 40100, work_status: "complete rated", assigned_employees: [{ id: "pro_a" }], schedule: { scheduled_start: "2026-10-15T15:00:00Z" }, work_timestamps: { started_at: "2026-10-15T15:05:00Z", completed_at: "2026-10-15T16:00:00Z" }, notes: [{ content: "weekday job, needs parts" }] },
    { id: id("e"), invoice_number: 40200, work_status: "user canceled", canceled_at: "2026-10-17T10:00:00Z", assigned_employees: [{ id: "pro_a" }], schedule: { scheduled_start: "2026-10-17T15:00:00Z" }, work_timestamps: {}, notes: [{ content: "canceled, needs parts" }] },
    { id: id("f"), invoice_number: 40300, work_status: "scheduled", assigned_employees: [{ id: "pro_b" }], schedule: { scheduled_start: "2026-10-18T14:00:00Z" }, work_timestamps: {}, notes: [] },
    { id: id("g"), invoice_number: 40400, work_status: "complete rated", assigned_employees: [{ id: "pro_b" }], schedule: { scheduled_start: "2026-10-18T19:00:00Z" }, work_timestamps: { started_at: "2026-10-18T19:05:00Z", completed_at: "2026-10-18T19:50:00Z" }, job_fields: { job_type: { name: "Install" } }, tags: ["Residential install"], notes: [{ content: "All set, door tested, customer happy" }] },
  ];
  const fullRecord = { ...jobs[1], notes: [{ content: "Cable snapped; customer will call back" }] };
  const hcp = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url.split("?")[0]}`);
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (mode === "down") return send(500, { error: "<html>internal secret-body-text</html>" });
    if (req.url.startsWith("/employees")) return send(200, { employees: [{ id: "pro_a", first_name: "Alex", last_name: "Tech", role: "field tech" }, { id: "pro_b", first_name: "Blake", last_name: "Tech", role: "field tech" }], page: 1, total_pages: 1, total_items: 2 });
    if (req.url.startsWith("/jobs/")) return req.url.split("?")[0] === `/jobs/${id("b")}` ? send(200, fullRecord) : send(404, {});
    if (req.url.startsWith("/jobs")) return send(200, { jobs, page: 1, total_pages: 1, total_items: jobs.length });
    send(404, {});
  });
  await new Promise((r) => hcp.listen(0, "127.0.0.1", r));
  process.env.HCP_BASE_URL = `http://127.0.0.1:${hcp.address().port}`;
  process.env.HCP_API_KEY = "test-key";

  const entry = path.join(TMP, "entry-weekend-recap.ts");
  fs.writeFileSync(entry, `export * as route from "@/app/api/weekend-recap/route"; export { resetWeekendRecapCache } from "@/lib/weekend-recap"; export { resetJobWatchCache } from "@/lib/job-watch";`);
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", alias: { "@": SRC }, external: ["next/server"], logLevel: "silent" });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, (x) => require(x === "next/server" ? NEXT : x));
  const { route, resetWeekendRecapCache, resetJobWatchCache } = mod.exports;
  const reset = () => { resetWeekendRecapCache(); resetJobWatchCache(); requests.length = 0; };
  const get = async (query = "") => { pinTime(true); try { const r = await route.GET(new Request(`http://localhost/api/weekend-recap${query}`)); return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control") }; } finally { pinTime(false); } };

  let r = await get();
  const items = r.body.items || [];
  const byLabel = (n) => items.find((i) => i.label.endsWith(`#${n}`));
  check("R1 answers 200 with ok:true, never cached", r.status === 200 && r.body.ok === true && r.cache === "no-store", JSON.stringify(r.body).slice(0, 300));
  check("R2 the weekend is Fri Oct 16 6 PM to Sun Oct 18 10 PM, and it is over", r.body.window.label === "Fri, Oct 16, 6 PM to Sun, Oct 18, 10 PM" && r.body.window.isCurrent === false && r.body.window.back === 0, JSON.stringify(r.body.window));
  check("R3 the right jobs: four finished, one never started; the weekday job and the canceled one are left out", items.length === 5 && r.body.counts.total === 5 && r.body.counts.finished === 4 && !byLabel(40100) && !byLabel(40200), items.map((i) => i.label).join());
  check("R4 flagged jobs come first: no-notes job, never-started job, the 'needs a quote' job; then the clean job", items.slice(0, 4).every((i) => i.needsLook) && !items[4].needsLook && items[4].label.endsWith("#40400"), items.map((i) => i.label + ":" + i.needsLook).join());
  check("R5 the 'Needs a quote' note is flagged with the words found", byLabel(40883).reasons.join() === "words" && ["quote", "needs"].every((w) => byLabel(40883).words.includes(w)) && byLabel(40883).notes.join() === "Replaced spring. Needs a quote for a new opener. Gate code 9999", JSON.stringify(byLabel(40883)));
  check("R6 a finished job with no notes in the list had its full record read, and the notes came from that (flagged 'call back')", byLabel(40891).notes.join() === "Cable snapped; customer will call back" && byLabel(40891).words.includes("call back") && requests.filter((q) => q === `GET /jobs/${id("b")}`).length === 1, JSON.stringify(byLabel(40891)) + requests.join());
  check("R7 an empty notes list is 'no notes'", byLabel(40892).reasons.join() === "no-notes");
  check("R8 scheduled Saturday and never started is 'not finished'", byLabel(40300).state === "not-started" && byLabel(40300).reasons.join() === "unfinished");
  check("R9 techs are named from the employee list; the job type and number make the label; installs are told apart", byLabel(40883).techs.join() === "Alex Tech" && byLabel(40883).label === "Repair #40883" && byLabel(40400).kind === "install", JSON.stringify([byLabel(40883).techs, byLabel(40883).label, byLabel(40400).kind]));
  check("R10 each job has a safe Go to job link", items.every((i) => i.url === `https://pro.housecallpro.com/app/jobs/${i.id}`));
  check("R11 counts add up", JSON.stringify(r.body.counts) === JSON.stringify({ total: 5, finished: 4, needsLook: 4, withWords: 2, noNotes: 1, unfinished: 1 }), JSON.stringify(r.body.counts));
  const noNotesText = JSON.stringify(items.map((i) => ({ ...i, notes: [] })));
  check("R12 apart from the notes themselves, NO customer detail in the answer (name, phone, email, address, description)", !/Jane|Customer|501-555|jane@|Secret|Little Rock|72201|Fix spring/.test(noNotesText), noNotesText);
  check("R13 everything sent to Housecall Pro was a read (GET): the job list, the employees and ONE job's record", requests.every((q) => q.startsWith("GET ")) && requests.every((q) => /^GET \/(jobs|employees|jobs\/job_b{32})$/.test(q)), [...new Set(requests)].join());

  let before = requests.length;
  await get(); await get("?back=0");
  check("R14 asking again inside five minutes does not bother Housecall Pro again", requests.length === before);
  r = await get("?fresh=1");
  check("R15 ?fresh=1 skips the cache", requests.length > before && r.body.ok === true);
  before = requests.length; r = await get("?back=1");
  check("R16 ?back=1 is the weekend before (Oct 9 to Oct 11), asked for separately, and none of this weekend's jobs are in it", r.body.window.back === 1 && r.body.window.label === "Fri, Oct 9, 6 PM to Sun, Oct 11, 10 PM" && r.body.items.length === 0 && requests.length > before, JSON.stringify(r.body.window));
  r = await get("?back=99");
  check("R17 ?back=99 is held to 8 weekends back", r.body.window.back === 8);
  reset(); r = await get("?back=abc");
  check("R18 junk in ?back= means this weekend", r.body.window.back === 0 && r.body.items.length === 5);
  reset(); r = await get("?back=1.5");
  check("R19 so does a fraction", r.body.window.back === 0);

  reset(); process.env.JOB_WATCH_SHOW_NOTES = "off"; r = await get(); delete process.env.JOB_WATCH_SHOW_NOTES;
  check("R20 with JOB_WATCH_SHOW_NOTES=off: jobs listed, no note text anywhere, notesHidden is true, no job record was read, and nothing is flagged for notes", r.body.notesHidden === true && r.body.items.length === 5 && r.body.items.every((i) => i.notes.length === 0 && !i.reasons.includes("words") && !i.reasons.includes("no-notes")) && !/9999|Cable snapped|quote/.test(JSON.stringify(r.body.items)) && !requests.some((q) => q.startsWith("GET /jobs/job_")), requests.join());
  reset(); process.env.WEEKEND_RECAP_WORDS = "spring"; r = await get(); delete process.env.WEEKEND_RECAP_WORDS;
  check("R21 WEEKEND_RECAP_WORDS replaces the word list", r.body.words.join() === "spring" && byLabel2(r, 40883).words.join() === "spring" && !byLabel2(r, 40891).reasons.includes("words"));
  function byLabel2(res, n) { return res.body.items.find((i) => i.label.endsWith(`#${n}`)); }

  reset(); mode = "down";
  { const q = console.error; console.error = () => {}; r = await get(); console.error = q; }
  check("R22 when Housecall Pro is failing the route STILL answers 200, with ok:false and a plain message", r.status === 200 && r.body.ok === false && /problem on its side/.test(r.body.error), JSON.stringify(r.body));
  check("R23 ...and the raw error text never reaches the answer", !/secret-body|internal/.test(JSON.stringify(r.body)));
  mode = "ok"; reset(); delete process.env.HCP_API_KEY;
  { const q = console.error; console.error = () => {}; r = await get(); console.error = q; }
  check("R24 with no HCP_API_KEY: ok:false, says it is not connected, and no request was made", r.body.ok === false && /not connected yet/.test(r.body.error) && requests.length === 0, JSON.stringify([r.body, requests]));
  check("R25 the route only answers GET", typeof route.GET === "function" && route.POST === undefined && route.PUT === undefined && route.DELETE === undefined && route.PATCH === undefined);

  hcp.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { globalThis.Date = RealDate; console.error("TEST CRASH:", e); process.exit(2); });
