import http from "node:http";
import { spawn } from "node:child_process";
let passes = 0, failures = 0;
const check = (n, ok, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };

// A business time zone in which "right now" is about noon, so "100 minutes ago" is always the same business day.
const utcHour = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
const shift = ((Math.round(12 - utcHour) + 12 + 24) % 24) - 12;
const ZONE = shift === 0 ? "Etc/UTC" : shift > 0 ? `Etc/GMT-${shift}` : `Etc/GMT+${-shift}`;

const ALEX = "pro_" + "a".repeat(32), BLAKE = "pro_" + "b".repeat(32);
const employees = [{ id: ALEX, first_name: "Alex", last_name: "Tech", role: "field tech" }, { id: BLAKE, first_name: "Blake", last_name: "Tech", role: "field tech" }];
const SECRETS = ["Zelda", "Quimby", "Evergreen", "4471", "501-555-0142", "zelda@example.com"];
const min = (m) => new Date(Date.now() - m * 60_000).toISOString();
let n = 0;
const base = (o) => ({ id: "job_" + String(++n).padStart(32, "0"), assigned_employees: [{ id: ALEX }], invoice_number: 1000 + n,
  customer: { first_name: "Zelda", last_name: "Quimby", mobile_number: "501-555-0142", email: "zelda@example.com" }, address: { street: "742 Evergreen Terrace", zip: "72201" },
  notes: [{ content: "gate code 4471" }], ...o });
const done = (type, minutes, description, extra = {}) => { const start = 3 * 24 * 60; return base({ ...extra, work_status: "complete rated", job_fields: { job_type: { id: "jbt", name: type } }, description, work_timestamps: { started_at: min(start), completed_at: min(start - minutes) } }); };
const INSTALL_NOTE = "Install done; customer wants a quote for opener. Gate code 4471";
const INSTALL_DESC = "Install new opener for Zelda Quimby at 742 Evergreen Terrace, gate code 4471", SERVICE_DESC = "Fix spring for Zelda Quimby";
const jobs = [
  ...[60, 85, 95, 180, 240, 300].map((m) => done("Garage Door Install", m, INSTALL_DESC, { notes: [{ id: "n", content: INSTALL_NOTE }] })),
  ...[30, 35, 40, 45, 55, 62, 70, 90].map((m, i) => done("Service call", m, SERVICE_DESC, i < 2 ? { notes: undefined } : {})),
  ...[1, 2].map(() => base({ work_status: "complete unrated", notes: [], job_fields: { job_type: { name: "Service call" } }, description: SERVICE_DESC, work_timestamps: { started_at: null, completed_at: min(2 * 24 * 60) } })),
  base({ work_status: "in progress", assigned_employees: [{ id: ALEX }, { id: BLAKE }], job_fields: { job_type: { name: "Garage Door Install" } }, description: INSTALL_DESC, work_timestamps: { started_at: min(100) } }),
  base({ work_status: "in progress", job_fields: { job_type: { name: "Service call" } }, description: SERVICE_DESC, work_timestamps: { started_at: null } }),
  base({ work_status: "in progress", job_fields: { job_type: { name: "Service call" } }, description: SERVICE_DESC, work_timestamps: { started_at: min(2 * 24 * 60) } }),
  base({ work_status: "user canceled", job_fields: { job_type: { name: "Garage Door Install" } }, description: INSTALL_DESC, work_timestamps: {} }),
];

let methods = [], seen = [];
function startHcp(port, { rejectToken = false, jobList = jobs, pages = null, failJobs = false } = {}) {
  const s = http.createServer((req, res) => {
    methods.push(req.method); const u = new URL(req.url, "http://x"); seen.push(u.pathname + "?" + u.searchParams.toString());
    const send = (c, b) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (rejectToken && req.headers.authorization?.startsWith("Token ")) return send(401, { error: "no" });
    if (u.pathname === "/employees") return send(200, { page: 1, total_pages: 1, total_items: 2, employees });
    if (u.pathname === "/jobs") {
      if (failJobs) return send(500, { error: "<secret server detail Zelda>" });
      if (pages) { const p = Number(u.searchParams.get("page")); return send(200, { page: p, total_pages: pages.length, total_items: 99, jobs: pages[p - 1] }); }
      return send(200, { page: 1, total_pages: 1, total_items: jobList.length, jobs: jobList });
    }
    send(404, {});
  });
  return new Promise((r) => s.listen(port, () => r(s)));
}
const run = (port, args = [], env = {}) => new Promise((resolve) => {
  const p = spawn("node", ["scripts/hcp-jobwatch-probe.mjs", ...args], { cwd: new URL("../..", import.meta.url).pathname, env: { ...process.env, HCP_BASE_URL: `http://localhost:${port}`, HCP_API_KEY: "k", BUSINESS_TIMEZONE: ZONE, CONSOLE_URL: "http://127.0.0.1:1", JOB_WATCH_INSTALL_WORDS: "", JOB_WATCH_INSTALL_MINUTES: "", JOB_WATCH_SERVICE_MINUTES: "", ...env } });
  let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  const timer = setTimeout(() => p.kill(), 30000);
  p.on("close", (code) => { clearTimeout(timer); resolve({ out, code }); });
});

// ---- A: the full report against known data
let hcp = await startHcp(4301);
let r = await run(4301);
check("A1 exits 0 and shows which authorization style works", r.code === 0 && /Authorization style that works: Token/.test(r.out), r.out.slice(0, 300));
check("A2 counts the jobs and the statuses (canceled left out of the later sections)", /Jobs read: 20 scheduled between/.test(r.out) && /1 canceled\/deleted are left out/.test(r.out) && /by status: complete rated 14, in progress 3, complete unrated 2, user canceled 1/.test(r.out), r.out);
check("A3 Start and Finish taps: 16 finished, 14 with a Start tap (88%), all 16 with a Finish tap", /Finished jobs: 16\s+\|\s+with a Start tap: 14 \(88%\)\s+\|\s+with a Finish tap: 16 \(100%\)/.test(r.out), r.out);
check("A4 jobs in progress right now: 3, of which 2 have a Start tap", /Marked in progress right now: 3\s+\|\s+of those with a Start tap: 2/.test(r.out), r.out);
check("A5 the shape section lists the real field names and that job type is an object with a name", /job_fields: job_type \(object \(id, name\)\)/.test(r.out) && /work_timestamps: started_at, completed_at/.test(r.out) && /invoice_number 19/.test(r.out), r.out);
check("A6 the job type values are listed with counts (7 installs, 12 service)", /job type values:\s+"Service call" 12, "Garage Door Install" 7/.test(r.out), r.out);
check("A7 it says where the word 'install' appears (job type 7, description 7) and the final split", /job type 7, business unit 0, tags 0, name 0, description 7, line items 0/.test(r.out) && /7 of 19 jobs count as INSTALLS and 12 as service/.test(r.out), r.out);
check("A8 install durations: n=6, typical 2h 18m, 90th percentile 5h, longest 5h, 4 of 6 (67%) longer than 90", /installs \(n=6\): typical 2h 18m, 90th percentile 5h, longest 5h; 4 of 6 \(67%\) ran longer than 90 min/.test(r.out), r.out);
check("A9 service durations: n=8 (the two finished jobs with no Start tap are not counted), typical 50m, 90th percentile 1h 30m, 3 of 8 (38%) longer than 60", /service  \(n=8\): typical 50m, 90th percentile 1h 30m, longest 1h 30m; 3 of 8 \(38%\) ran longer than 60 min/.test(r.out), r.out);
check("A10 'right now': both techs, an install, started today, 1h 40m, flagged OVER the 90-minute limit", /Alex Tech and Blake Tech - install - started \d{1,2}:\d{2} [AP]M - 1h 40m \(OVER the 90-minute limit\)/.test(r.out), r.out);
check("A11 'right now' also counts the job with no Start tap (1) and the one from an earlier day (1)", /no Start tap \(cannot be checked\): 1/.test(r.out) && /EARLIER day[^\n]*: 1/.test(r.out), r.out);
check("A12a finished jobs and notes: the notes field, how many finished jobs have a readable note (12 of 16), typical and longest length, and the 2 jobs where the field is missing from the list", /field "notes" \(list of object \(id, content\)\) is filled in on 12 of 16 finished jobs/.test(r.out) && /at least one readable note in the "notes" field: 12 of 16 \(75%\); typical length 39 characters, longest 63/.test(r.out) && /missing entirely from 2 finished job\(s\)/.test(r.out), r.out);
check("A12b the notes themselves are NOT printed unless asked (the planted gate code never appears)", !r.out.includes("4471") && !r.out.includes("Install done") && /Add --notes to print the latest note/.test(r.out), r.out);
check("A12 with the console not running it says so instead of failing", /The console is not running at http:\/\/127\.0\.0\.1:1/.test(r.out), r.out);
check("A13 NO customer detail is printed anywhere (name, phone, email, street, gate code, description text)", !SECRETS.some((x) => r.out.includes(x)) && !/Install new opener|Fix spring/.test(r.out), SECRETS.filter((x) => r.out.includes(x)).join());
const jobsQuery = seen.find((x) => x.startsWith("/jobs?")) ?? "";
const qMin = Date.parse(new URL("http://x/" + jobsQuery).searchParams.get("scheduled_start_min") ?? "");
check("A14 it looks back 14 days by default", Math.abs((Date.now() - qMin) / 86_400_000 - 14) < 0.01, jobsQuery);
check("A15 nothing was written: every request was a GET, and only to /employees and /jobs", methods.length > 0 && methods.every((m) => m === "GET") && seen.every((x) => /^\/(employees|jobs)\?/.test(x)), [...new Set(methods)].join() + " " + [...new Set(seen.map((x) => x.split("?")[0]))].join());
r = await run(4301, ["--notes"]);
check("A17 with --notes it prints the latest note from up to 3 finished jobs (the 3 most recently finished that HAVE notes)", (r.out.match(/latest note, job finished/g) || []).length === 3 && (r.out.match(/Install done; customer wants a quote for opener\. Gate code 4471/g) || []).length === 3 && /can contain customer details/.test(r.out), r.out);
check("A18 even with --notes nothing else about the customer is printed", !["Zelda", "Quimby", "Evergreen", "501-555-0142", "zelda@example.com", "Fix spring", "Install new opener"].some((x) => r.out.includes(x)), r.out);
r = await run(4301, ["--notes", "30"]);
check("A19 the flag can come before or after the number of days", r.code === 0 && /\(n=6\)/.test(r.out) && /latest note/.test(r.out));
r = await run(4301, ["--bogus"]);
check("A20 an unknown flag is refused with the usage line", r.code === 1 && /Usage: node scripts\/hcp-jobwatch-probe\.mjs \[days back, 1 to 60\] \[--notes\]/.test(r.out), r.out);
r = await run(4301, ["30"]);
const q30 = Date.parse(new URL("http://x/" + seen.filter((x) => x.startsWith("/jobs?")).pop()).searchParams.get("scheduled_start_min"));
check("A16 a custom look-back (30 days) is used", Math.abs((Date.now() - q30) / 86_400_000 - 30) < 0.01 && r.code === 0);

// ---- B: your own words and minutes
r = await run(4301, [], { JOB_WATCH_INSTALL_WORDS: "service", JOB_WATCH_INSTALL_MINUTES: "120", JOB_WATCH_SERVICE_MINUTES: "30" });
check("B1 custom words are used and shown ('service' now means install: 12 of 19)", /words that mean install: "service"/.test(r.out) && /12 of 19 jobs count as INSTALLS/.test(r.out), r.out);
check("B2 custom minutes are used in the comparison", /Limits now: install 120 min, other work 30 min/.test(r.out), r.out);

// ---- C: the running console's own answer
const consoleStandIn = http.createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, watching: 2, cantTell: 1, ignoredOlder: 1, rules: { completedHours: 3 }, alerts: [{ techs: ["Alex Tech", "Blake Tech"], label: "Garage Door Install #1019", minutesOnJob: 100, limitMinutes: 90 }], completed: [{ notes: ["Done"] }, { notes: [] }] })); });
await new Promise((rr) => consoleStandIn.listen(4302, rr));
r = await run(4301, [], { CONSOLE_URL: "http://localhost:4302" });
check("C1 it prints what the running console says for comparison, including each alert", /reports: watching 2, 1 alert\(s\), 1 it cannot check, 1 from earlier days/.test(r.out) && /ALERT: Alex Tech and Blake Tech on "Garage Door Install #1019" for 1h 40m \(limit 1h 30m\)/.test(r.out) && /2 finished job\(s\) in the last 3 hours \(1 with notes\)/.test(r.out), r.out);
consoleStandIn.close();
const brokenConsole = http.createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "Housecall Pro is not connected yet (HCP_API_KEY is empty)." })); });
await new Promise((rr) => brokenConsole.listen(4303, rr));
r = await run(4301, [], { CONSOLE_URL: "http://localhost:4303" });
check("C2 if the console reports a problem, that is shown too", /answered, but says: Housecall Pro is not connected yet/.test(r.out), r.out);
brokenConsole.close(); hcp.close();

// ---- D: other cases
hcp = await startHcp(4304, { rejectToken: true });
r = await run(4304);
check("D1 when 'Token' is refused it falls back to 'Bearer'", /Authorization style that works: Bearer/.test(r.out) && r.code === 0, r.out.slice(0, 200));
hcp.close();
hcp = await startHcp(4305, { jobList: [] });
r = await run(4305);
check("D2 no jobs at all: a friendly message and exit 0", r.code === 0 && /No jobs in that period/.test(r.out) && /try a longer look-back/i.test(r.out), r.out);
hcp.close();
hcp = await startHcp(4306, { pages: [[done("Service call", 40, SERVICE_DESC)], [done("Garage Door Install", 200, INSTALL_DESC)]] });
r = await run(4306);
check("D3 jobs on several pages are all read", /Jobs read: 2 scheduled/.test(r.out) && /installs \(n=1\)/.test(r.out) && /service  \(n=1\)/.test(r.out), r.out);
hcp.close();
hcp = await startHcp(4307, { jobList: [
  { id: "job_x1", work_status: "complete rated", job_fields: { job_type: "Garage Door Install" }, tags: ["Residential", { name: "VIP" }], assigned_employees: [{ id: ALEX }], work_timestamps: { started_at: min(500), completed_at: min(300) } },
  { id: "job_x2", work_status: "complete rated", job_fields: null, tags: null, work_timestamps: null },
  { id: "job_x3", work_status: "in progress", job_fields: { job_type: 42, business_unit: { name: "Residential Install" } }, assigned_employees: null, work_timestamps: { started_at: min(10) } },
] });
r = await run(4307);
check("D4 odd shapes (text job type, tags as text and objects, nulls, a number) never crash it", r.code === 0 && /job type values:\s+"Garage Door Install" 1/.test(r.out) && /tag values:[^\n]*"Residential" 1[^\n]*"VIP" 1/.test(r.out) && /business unit values:\s+"Residential Install" 1/.test(r.out), r.out);
check("D5 someone on a job with nobody assigned is still reported", /nobody assigned - install - started/.test(r.out), r.out);
hcp.close();
hcp = await startHcp(4308, { failJobs: true });
r = await run(4308);
check("D6 when Housecall Pro fails on the job list it stops with a plain message and never prints the server's text", r.code === 1 && /HTTP 500 for the job list/.test(r.out) && !/Zelda|secret server/.test(r.out), r.out);
hcp.close();

// ---- E: bad input
r = await run(4301, [], { HCP_API_KEY: "" }); check("E1 no API key is refused with the fix", r.code === 1 && /HCP_API_KEY is empty/.test(r.out), r.out);
for (const bad of ["abc", "0", "61", "1.5", "-3"]) { r = await run(4301, [bad]); check(`E2 a bad look-back "${bad}" is refused with the usage line`, r.code === 1 && /Usage: node scripts\/hcp-jobwatch-probe\.mjs/.test(r.out), r.out); }
const dead = await run(1, []);
check("E3 an unreachable Housecall Pro ends with an error and exit code, not a hang", dead.code !== 0, dead.out.slice(0, 200));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
