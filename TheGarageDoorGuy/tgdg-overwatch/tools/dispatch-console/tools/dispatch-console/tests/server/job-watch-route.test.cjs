// The real route, through the real Housecall Pro client, against a stand-in Housecall Pro server.
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

// A business time zone in which "right now" is about noon, so "started 100 minutes ago" is always the same business day.
const utcHour = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
const shift = ((Math.round(12 - utcHour) + 12 + 24) % 24) - 12;
process.env.BUSINESS_TIMEZONE = shift === 0 ? "Etc/UTC" : shift > 0 ? `Etc/GMT-${shift}` : `Etc/GMT+${-shift}`;

(async () => {
  // ---- the stand-in Housecall Pro
  const requests = [];
  let mode = "ok";
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const jobs = [
    { id: "job_" + "a".repeat(32), work_status: "in progress", invoice_number: 4521, assigned_employees: [{ id: "pro_a" }],
      work_timestamps: { started_at: ago(100) }, job_fields: { job_type: { name: "Garage Door Install" } },
      customer: { first_name: "Jane", last_name: "Customer", mobile_number: "501-555-0101", email: "jane@example.com" },
      address: { street: "12 Secret Ln", city: "Little Rock", zip: "72201" }, description: "Install for Jane at 12 Secret Ln", notes: [{ content: "gate code 1234" }] },
    { id: "job_" + "b".repeat(32), work_status: "in progress", assigned_employees: [{ id: "pro_b" }], work_timestamps: { started_at: ago(20) }, job_fields: { job_type: { name: "Service call" } } },
    { id: "job_" + "c".repeat(32), work_status: "scheduled", assigned_employees: [{ id: "pro_a" }], work_timestamps: {} },
    { id: "job_" + "d".repeat(32), work_status: "complete rated", invoice_number: 4600, assigned_employees: [{ id: "pro_a" }], work_timestamps: { started_at: ago(85), completed_at: ago(20) },
      job_fields: { job_type: { name: "Service call" } }, notes: [{ id: "n1", content: "Replaced spring. Needs a quote for a new opener. Gate code 9999" }],
      customer: { first_name: "Jane", last_name: "Customer", mobile_number: "501-555-0101", email: "jane@example.com" }, address: { street: "12 Secret Ln", city: "Little Rock", zip: "72201" }, description: "Fix spring for Jane Customer" },
    { id: "job_" + "e".repeat(32), work_status: "complete rated", assigned_employees: [{ id: "pro_b" }], work_timestamps: { started_at: ago(120), completed_at: ago(30) }, job_fields: { job_type: { name: "Service call" } },
      customer: { first_name: "Jane", last_name: "Customer" } },
  ];
  const EID = "job_" + "e".repeat(32), DID = "job_" + "d".repeat(32);
  const fullRecord = { ...jobs[4], notes: [{ content: "Cable snapped; customer will call back" }] };
  let estimatesDown = false;
  const EST_FIELD = "csr_" + "1".repeat(32), EST_OFFICE = "csr_" + "2".repeat(32);
  const estimates = [
    { id: EST_FIELD, estimate_number: "8801", work_status: "complete unrated", created_at: ago(300), customer: { first_name: "Zelda", last_name: "Quimby" }, address: { street: "742 Evergreen Terrace" },
      work_timestamps: { started_at: ago(60), completed_at: ago(10) }, assigned_employees: [{ id: "pro_a", first_name: "Alex", last_name: "Tech" }],
      options: [{ id: "est_" + "1".repeat(32), name: "Steel Back", total_amount: 150000, approval_status: null, status: "submitted for signoff", tags: ["Jasen Est", "*"], notes: [{ content: "gate code 4471" }] }] },
    { id: EST_OFFICE, estimate_number: "8802", work_status: "scheduled", created_at: ago(4 * 1440), customer: { first_name: "Zelda", last_name: "Quimby" },
      work_timestamps: {}, assigned_employees: [{ id: "pro_b", first_name: "Blake", last_name: "Tech" }], options: [{ id: "est_" + "2".repeat(32), name: "Option 1", total_amount: 99000, approval_status: null, status: "submitted for signoff", tags: [] }] },
  ];
  const hcp = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url.split("?")[0]}`);
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (mode === "down") return send(500, { error: "<html>internal secret-body-text</html>" });
    if (req.url.startsWith("/estimates")) return estimatesDown ? send(500, { error: "<secret-body Zelda>" }) : send(200, { estimates, page: 1, total_pages: 1, total_items: estimates.length });
    if (req.url.startsWith("/employees")) return send(200, { employees: [{ id: "pro_a", first_name: "Alex", last_name: "Tech", role: "field tech" }, { id: "pro_b", first_name: "Blake", last_name: "Tech", role: "field tech" }], page: 1, total_pages: 1, total_items: 2 });
    if (req.url.startsWith("/jobs/")) return req.url.split("?")[0] === `/jobs/${EID}` ? send(200, fullRecord) : send(404, {});
    if (req.url.startsWith("/jobs")) return send(200, { jobs, page: 1, total_pages: 1, total_items: jobs.length });
    send(404, {});
  });
  await new Promise((r) => hcp.listen(0, "127.0.0.1", r));
  process.env.HCP_BASE_URL = `http://127.0.0.1:${hcp.address().port}`;
  process.env.HCP_API_KEY = "test-key";

  const entry = path.join(TMP, "entry-job-watch.ts");
  fs.writeFileSync(entry, `export * as route from "@/app/api/job-watch/route"; export { resetJobWatchCache } from "@/lib/job-watch"; export { resetEstimateCaches } from "@/lib/estimates";`);
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", alias: { "@": SRC }, external: ["next/server"], logLevel: "silent" });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, (id) => require(id === "next/server" ? NEXT : id));
  const { route, resetJobWatchCache: resetJobs, resetEstimateCaches } = mod.exports;
  const resetJobWatchCache = () => { resetJobs(); resetEstimateCaches(); };
  const jobsDone = (body) => body.completed.filter((c) => c.kind !== "estimate");
  const get = async () => { const r = await route.GET(); return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control") }; };

  let r = await get();
  check("R1 answers 200 with the install that has run 100 minutes", r.status === 200 && r.body.ok === true && r.body.alerts.filter((a) => a.kind !== "estimate").length === 1 && r.body.alerts[0].kind === "install" && r.body.alerts[0].minutesOnJob >= 99, JSON.stringify(r.body));
  check("R2 it names the tech from Housecall Pro's employee list, and gives the job type and number", r.body.alerts[0].techs.join() === "Alex Tech" && r.body.alerts[0].label === "Garage Door Install #4521", JSON.stringify(r.body.alerts[0]));
  check("R3 two jobs are being watched (the scheduled one is not), and the 20-minute service call is quiet", r.body.watching === 2 && r.body.cantTell === 0, JSON.stringify(r.body));
  check("R4 it tells the browser never to cache", r.cache === "no-store");
  const withoutFinished = JSON.stringify({ ...r.body, completed: undefined });
  check("R5 NO customer detail anywhere in the answer, and the notes of a job still running (gate code 1234) never appear", !/Jane|Customer|501-555|jane@|Secret|Little Rock|72201|Install for|Fix spring/.test(JSON.stringify(r.body)) && !/1234/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  const first = requests.length;
  await get(); await get();
  check("R6 asking again inside a minute does not bother Housecall Pro again", requests.length === first, `${requests.length - first} extra requests`);
  check("R7 everything sent to Housecall Pro was a read (GET): the job list, the employees, the estimate list, and ONE job's full record", requests.every((q) => q.startsWith("GET ")) && requests.every((q) => /^GET \/(jobs|employees|estimates|jobs\/job_e{32})$/.test(q)), [...new Set(requests)].join());
  check("R20 the estimates ride along: a tech's just-finished estimate is a finished bar listing the options and amounts", r.body.estimatesOk === true && r.body.completed.some((c) => c.kind === "estimate" && c.label === "Estimate #8801" && c.techs.join() === "Alex Tech" && c.notes.join() === "Steel Back: $1,500" && c.url === `https://pro.housecallpro.com/app/estimates/est_${"1".repeat(32)}`), JSON.stringify(r.body.completed));
  check("R21 ...and an office-made estimate unanswered for 4 days is a waiting bar after the job alerts", r.body.alerts.length === 2 && r.body.alerts[0].kind === "install" && r.body.alerts[1].kind === "estimate" && r.body.alerts[1].label === "Estimate #8802 ($990)" && r.body.alerts[1].url === `https://pro.housecallpro.com/app/estimates/est_${"2".repeat(32)}`, JSON.stringify(r.body.alerts));
  check("R22 no customer detail from the estimates anywhere (name, address, the note's gate code)", !/Zelda|Quimby|Evergreen|4471/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  const detailReads = () => requests.filter((q) => q === `GET /jobs/${EID}`).length;
  check("R12 two finished jobs are reported, newest first", jobsDone(r.body).length === 2 && jobsDone(r.body)[0].jobId === DID && jobsDone(r.body)[1].jobId === EID, JSON.stringify(jobsDone(r.body).map((c) => c.jobId)));
  check("R13 the first one carries its notes from the job list, with who, what, when and how long it took", jobsDone(r.body)[0].notes.join() === "Replaced spring. Needs a quote for a new opener. Gate code 9999" && jobsDone(r.body)[0].techs.join() === "Alex Tech" && jobsDone(r.body)[0].label === "Service call #4600" && jobsDone(r.body)[0].minutesOnJob === 65 && jobsDone(r.body)[0].notesPending === false, JSON.stringify(jobsDone(r.body)[0]));
  check("R14 the second had no notes in the list: its full record was read (once) and the notes came from that", jobsDone(r.body)[1].notes.join() === "Cable snapped; customer will call back" && detailReads() === 1, JSON.stringify(jobsDone(r.body)[1]) + " reads " + detailReads());
  check("R15 the first needed no extra read (its notes were already in the list)", !requests.includes(`GET /jobs/${DID}`));
  check("R16 the notes are the ONLY customer-related text returned: no name, phone, email, address, or description (even for finished jobs)", !/Jane|501-555|jane@|Secret|Little Rock|72201|Fix spring/.test(JSON.stringify(jobsDone(r.body))), JSON.stringify(jobsDone(r.body)));
  check("R17 the notes of a finished job are not repeated inside the overtime alerts or counts", !withoutFinished.includes("9999") && !withoutFinished.includes("Cable snapped"), withoutFinished);

  resetJobWatchCache(); requests.length = 0; process.env.JOB_WATCH_SHOW_NOTES = "off";
  r = await get();
  delete process.env.JOB_WATCH_SHOW_NOTES;
  check("R18 with JOB_WATCH_SHOW_NOTES=off the finished jobs are still announced but no note text is returned and it says notes are hidden", jobsDone(r.body).length === 2 && jobsDone(r.body).every((c) => c.notes.length === 0 && c.notesHidden === true) && !/9999|Cable snapped|Replaced spring/.test(JSON.stringify(r.body)), JSON.stringify(jobsDone(r.body)));
  check("R19 ...and no full record was read from Housecall Pro (nothing to fetch)", detailReads() === 0, requests.join());

  resetJobWatchCache(); estimatesDown = true; requests.length = 0;
  { const q = console.error; console.error = () => {};
    r = await get(); console.error = q; }
  check("R23 if only the estimates fail, the job bars still work and estimatesOk is false", r.status === 200 && r.body.ok === true && r.body.estimatesOk === false && r.body.alerts.length === 1 && r.body.alerts[0].kind === "install", JSON.stringify(r.body));
  check("R24 ...and the raw error text never reaches the answer", !/secret-body|Zelda/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  estimatesDown = false;
  resetJobWatchCache(); mode = "down"; requests.length = 0;
  const quiet = console.error; console.error = () => {};
  r = await get();
  console.error = quiet;
  check("R8 when Housecall Pro is failing the route STILL answers 200, with ok:false and a plain message", r.status === 200 && r.body.ok === false && /problem on its side/.test(r.body.error), JSON.stringify(r.body));
  check("R9 ...and the raw error text never reaches the answer", !/secret-body|internal/.test(JSON.stringify(r.body)), JSON.stringify(r.body));

  resetJobWatchCache(); requests.length = 0; delete process.env.HCP_API_KEY;
  console.error = () => {};
  r = await get();
  console.error = quiet;
  check("R10 with no HCP_API_KEY: ok:false, says it is not connected, and no request was made", r.body.ok === false && /not connected yet/.test(r.body.error) && requests.length === 0, JSON.stringify([r.body, requests]));
  check("R11 the route only answers GET", typeof route.GET === "function" && route.POST === undefined && route.PUT === undefined && route.DELETE === undefined && route.PATCH === undefined);

  hcp.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
