import http from "node:http";
import { spawn } from "node:child_process";
let passes = 0, failures = 0;
const check = (n, ok, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };

const SECRETS = ["Zelda", "Quimby", "Evergreen", "4471", "501-555-0142", "zelda@example.com"];
const day = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
let n = 0;
const est = (o = {}) => ({
  id: "est_" + String(++n).padStart(32, "0"), work_status: "scheduled", created_at: day(2),
  customer: { first_name: "Zelda", last_name: "Quimby", mobile_number: "501-555-0142", email: "zelda@example.com" },
  address: { street: "742 Evergreen Terrace", zip: "72201" }, notes: [{ content: "gate code 4471" }],
  assigned_employees: [{ id: "pro_a", first_name: "Alex", last_name: "Tech" }],
  schedule: { scheduled_start: day(2), scheduled_end: day(2) },
  options: [{ id: "o1", name: "Option 1", approval_status: "pro approved", total_amount: 125000 }], ...o,
});
const estimates = [
  est({ created_at: day(1) }), est({ created_at: day(5), options: [{ approval_status: "declined", total_amount: 90000 }] }),
  est({ created_at: day(10), options: [{ approval_status: "approved", total_amount: 250000 }, { approval_status: "declined", total_amount: 300000 }] }),
  est({ created_at: day(20), assigned_employees: [], schedule: {} }), est({ created_at: day(45) }), est({ created_at: day(120), work_status: "complete" }),
];
const jobs = [
  { id: "job_1", original_estimate_id: estimates[0].id, customer: { first_name: "Zelda" } }, { id: "job_2", original_estimate_id: "est_unknown" }, { id: "job_3" },
];

let methods = [], seen = [];
function startHcp(port, { rejectToken = false, list = estimates, status = 200, pages = null } = {}) {
  const s = http.createServer((req, res) => {
    methods.push(req.method); const u = new URL(req.url, "http://x"); seen.push(u.pathname);
    const send = (c, b) => { res.writeHead(c, { "content-type": "application/json" }); res.end(typeof b === "string" ? b : JSON.stringify(b)); };
    if (rejectToken && req.headers.authorization?.startsWith("Token ")) return send(401, { error: "no" });
    if (u.pathname === "/estimates") {
      if (status !== 200) return send(status, { error: "<secret Zelda>" });
      if (pages) { const p = Number(u.searchParams.get("page")); return send(200, { page: p, total_pages: pages.length, estimates: pages[p - 1] }); }
      return send(200, { page: 1, total_pages: 1, total_items: list.length, estimates: list });
    }
    if (u.pathname === "/jobs") return send(200, { page: 1, total_pages: 1, jobs });
    send(404, {});
  });
  return new Promise((r) => s.listen(port, () => r(s)));
}
const run = (port, args = [], env = {}) => new Promise((resolve) => {
  const p = spawn("node", ["scripts/hcp-estimates-probe.mjs", ...args], { cwd: new URL("../..", import.meta.url).pathname, env: { ...process.env, HCP_BASE_URL: `http://localhost:${port}`, HCP_API_KEY: "test-key", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  const timer = setTimeout(() => p.kill(), 30000);
  p.on("close", (code) => { clearTimeout(timer); resolve({ out, code }); });
});

let hcp = await startHcp(4311);
let r = await run(4311);
check("E1 exits 0 and shows which authorization style works", r.code === 0 && /Authorization style that works: Token/.test(r.out), r.out.slice(0, 300));
check("E2 reads all 6 estimates", /Read 6 estimates in 1 page/.test(r.out), r.out);
check("E3 shows the estimate's field names, with customer fields marked private and not shown", /customer: object .*\[private, value hidden\]/.test(r.out) && /address: object .*\[private, value hidden\]/.test(r.out) && /work_status: text/.test(r.out), r.out);
check("E4 counts the status values", /work_status: scheduled 5, complete 1/.test(r.out), r.out);
check("E5 counts option approval statuses and options per estimate", /pro approved 4/.test(r.out) && /declined 2/.test(r.out) && /approved 1/.test(r.out) && /2 option\(s\) x 1/.test(r.out), r.out);
check("E6 ages are bucketed", /under 3 days 1, 3 to 7 days 1, 8 to 14 days 1, 15 to 30 days 1, 31 to 90 days 1, over 90 days 1/.test(r.out), r.out);
check("E7 raw amounts are shown so dollars vs cents can be told", /min 90000, median 125000, max 300000/.test(r.out), r.out);
check("E8 counts techs and schedules", /with assigned_employees: 5 of 6/.test(r.out) && /with a schedule: 5 of 6/.test(r.out) && /Alex Tech 5/.test(r.out), r.out);
check("E9 counts jobs that point back at an estimate and finds one", /jobs read: 3; with original_estimate_id\/uuids: 2; of those, the estimate was among the 6 read: 1/.test(r.out), r.out);
check("E10 nothing private is printed anywhere", SECRETS.every((s) => !r.out.includes(s)), SECRETS.filter((s) => r.out.includes(s)).join());
check("E10b labels are listed by name and count, still no customer text", /7\. Labels/.test(r.out) && /tags on options:/.test(r.out) && /option names/.test(r.out), r.out.slice(-600));
check("E11 only GET requests were made", methods.length > 0 && methods.every((m) => m === "GET"), methods.join());
hcp.close();

hcp = await startHcp(4312, { rejectToken: true });
r = await run(4312);
check("E12 falls back to the Bearer style", r.code === 0 && /Authorization style that works: Bearer/.test(r.out), r.out.slice(0, 200));
hcp.close();

hcp = await startHcp(4313, { status: 403 });
r = await run(4313);
check("E13 a refused estimate list gives a plain message and no private text", r.code === 1 && /answered 403/.test(r.out) && !r.out.includes("Zelda") && !r.out.includes("secret"), r.out);
hcp.close();

hcp = await startHcp(4314, { list: [] });
r = await run(4314);
check("E14 no estimates: says so and stops cleanly", r.code === 0 && /No estimates came back/.test(r.out), r.out);
hcp.close();

const full = Array.from({ length: 100 }, () => est()); const page2 = Array.from({ length: 30 }, () => est());
hcp = await startHcp(4315, { pages: [full, page2] });
r = await run(4315);
check("E15 follows pages", /Read 130 estimates in 2 page/.test(r.out), r.out);
r = await run(4315, ["1"]);
check("E16 a page limit is respected", /Read 100 estimates in 1 page/.test(r.out), r.out);
hcp.close();

hcp = await startHcp(4316, { list: [{ id: "x1", options: "weird", assigned_employees: "weird", schedule: 5, created_at: "not a date" }, null, 7, { id: "x2" }] });
r = await run(4316);
check("E17 strange or missing fields never crash it", r.code === 0 && /Done\./.test(r.out), r.out.slice(-300));
hcp.close();

r = await run(4316, ["0"]); check("E18 a bad page count is refused", r.code === 1 && /Usage/.test(r.out));
r = await run(4316, [], { HCP_API_KEY: "" }); check("E19 a missing key says so", r.code === 1 && /HCP_API_KEY is empty/.test(r.out));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
