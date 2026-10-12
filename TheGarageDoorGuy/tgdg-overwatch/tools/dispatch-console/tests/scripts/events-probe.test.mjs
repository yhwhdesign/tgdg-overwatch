import http from "node:http";
import { spawn } from "node:child_process";
let passes = 0, failures = 0;
const check = (n, ok, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };

const DRAY = "pro_" + "d".repeat(32), MATT = "pro_" + "e".repeat(32);
const employees = [{ id: DRAY, first_name: "Drayton", last_name: "Wilson", role: "field tech" }, { id: MATT, first_name: "Matthew", last_name: "Tucker", role: "field tech" }];
const SECRET_TITLE = "Pick up door for Zelda Quimby", SECRET_DESC = "742 Evergreen Terrace gate code 4471";

const shapes = {
  // A: objects for people, name/description text, a recurrence block
  A: () => ({ page: 1, total_pages: 1, total_items: 3, events: [
    { id: "evt_" + "1".repeat(32), name: SECRET_TITLE, description: SECRET_DESC, start_time: "2026-10-08T13:00:00Z", end_time: "2026-10-08T14:30:00Z", all_day: false, assigned_employees: [{ id: DRAY, first_name: "Drayton", last_name: "Wilson" }], recurrence: { frequency: "weekly", interval: 1 } },
    { id: "evt_" + "2".repeat(32), name: "Team meeting", start_time: "2026-10-08T15:00:00Z", end_time: "2026-10-08T16:00:00Z", all_day: false, assigned_employees: [{ id: MATT }] },
    { id: "evt_" + "3".repeat(32), name: "Safety day", start_time: "2026-10-08T13:00:00Z", end_time: "2026-10-08T23:00:00Z", all_day: true, assigned_employees: [{ id: DRAY }, { id: MATT }] },
  ] }),
  // B: plain id lists and different field names
  B: () => ({ events: [{ id: "evt_" + "4".repeat(32), title: SECRET_TITLE, notes: SECRET_DESC, start: "2026-10-08T13:00:00Z", end: "2026-10-08T14:00:00Z", employee_ids: [DRAY] }] }),
};
let methods = [], seen = [];
function start(port, { shape = "A", rejectAll = false, rejectDates = false, noEvents = false } = {}) {
  const s = http.createServer((req, res) => {
    methods.push(req.method); const u = new URL(req.url, "http://x"); seen.push(u.pathname + "?" + u.searchParams.toString());
    const send = (c, b) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (u.pathname === "/employees") return send(200, { page: 1, total_pages: 1, total_items: 2, employees });
    if (u.pathname === "/events") {
      if (rejectAll) return send(400, { error: { message: "nope" } });
      if (rejectDates && u.searchParams.has("start_date")) return send(400, { error: { message: "bad date" } });
      return send(200, noEvents ? { events: [] } : shapes[shape]());
    }
    send(404, {});
  });
  return new Promise((r) => s.listen(port, () => r(s)));
}
const run = (port, args) => new Promise((resolve) => {
  const p = spawn("node", ["scripts/hcp-events-probe.mjs", ...args], { cwd: new URL("../..", import.meta.url).pathname, env: { ...process.env, HCP_BASE_URL: `http://localhost:${port}`, HCP_API_KEY: "k", BUSINESS_TIMEZONE: "America/Chicago" } });
  let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  const timer = setTimeout(() => p.kill(), 30000);
  p.on("close", (code) => { clearTimeout(timer); resolve({ out, code }); });
});

// ---- A: plain dates work, object-style people
let s = await start(4101, { shape: "A" });
let r = await run(4101, ["Drayton Wilson", "2026-10-08"]);
check("A: first way of asking worked and is reported", /date range as plain dates: HTTP 200/.test(r.out) && /Worked: date range as plain dates/.test(r.out), r.out.slice(0, 400));
check("A: asks with start_date and end_date as the next day", seen.some((x) => x.startsWith("/events?") && x.includes("start_date=2026-10-08") && x.includes("end_date=2026-10-09")), seen.join(" | "));
check("A: lists the top-level fields of the answer", /Top-level fields in the answer: page, total_pages, total_items, events/.test(r.out));
check("A: shows the event's field names", /event\.start_time/.test(r.out) && /event\.assigned_employees\[\]\.id/.test(r.out) && /event\.recurrence\.frequency/.test(r.out));
check("A: finds exactly HIS two events (his errand and the all-day safety day), not the other tech's meeting", /Drayton Wilson's events on 2026-10-08: 2/.test(r.out) && !/Team meeting/.test(r.out), r.out);
check("A: times converted to local, 8:00 AM for 13:00Z", /2026-10-08T13:00:00Z\s+=\s+Thu, Oct 8, 8:00 AM/.test(r.out));
check("A: says where in the data he is attached", /he is attached at: event\.assigned_employees\[\]\.id/.test(r.out));
check("A: names who else is on a shared event", /also on it: Matthew Tucker/.test(r.out));
check("A: flags recurrence fields", /recurrence-related fields present: recurrence, frequency/.test(r.out), r.out);
check("A: the title, description, customer and address are HIDDEN by default", !r.out.includes("Zelda") && !r.out.includes("Evergreen") && !r.out.includes("4471") && !r.out.includes("Pick up door") && /event\.name: <string, hidden>/.test(r.out) && /event\.description: <string, hidden>/.test(r.out), r.out);
r = await run(4101, ["Drayton Wilson", "2026-10-08", "--titles"]);
check("A: --titles shows the title only when asked", r.out.includes("title: Pick up door for Zelda Quimby"));
check("A: nothing was written: every request was a GET", methods.length > 0 && methods.every((m) => m === "GET"), [...new Set(methods)].join());
r = await run(4101, ["Nobody Here", "2026-10-08"]); check("A: unknown person is refused with the real names", r.code === 1 && /No employee matches/.test(r.out) && /Drayton Wilson/.test(r.out));
r = await run(4101, ["Drayton Wilson", "10/08/2026"]); check("A: a bad date is refused", r.code === 1 && /must look like 2026-10-08/.test(r.out));
r = await run(4101, ["t"]); check("A: an ambiguous name is refused", r.code === 1 && /More than one person/.test(r.out), r.out);
s.close();

// ---- B: different field names, plain id lists
s = await start(4102, { shape: "B" });
r = await run(4102, ["Drayton Wilson", "2026-10-08"]);
check("B: works with a different shape (start/end, employee_ids)", /Drayton Wilson's events on 2026-10-08: 1/.test(r.out) && /start: 2026-10-08T13:00:00Z\s+=\s+Thu, Oct 8, 8:00 AM/.test(r.out) && /he is attached at: event\.employee_ids\[\]/.test(r.out), r.out);
check("B: title and notes hidden under their other names too", !r.out.includes("Zelda") && !r.out.includes("4471") && /event\.title: <string, hidden>/.test(r.out) && /event\.notes: <string, hidden>/.test(r.out));
s.close();

// ---- C: plain dates rejected -> falls back to timestamps, then to no filter
s = await start(4103, { shape: "A", rejectDates: true });
r = await run(4103, ["Drayton Wilson", "2026-10-08"]);
check("C: when date filters are refused it falls back and SAYS the result is not limited to the day", /date range as plain dates: HTTP 400/.test(r.out) && /date range as full timestamps: HTTP 400/.test(r.out) && /NOT limited to the day/.test(r.out), r.out);
s.close();

// ---- D: nothing works / nothing found
s = await start(4104, { rejectAll: true });
r = await run(4104, ["Drayton Wilson", "2026-10-08"]);
check("D: if HCP refuses every request, it says so plainly and shows the statuses", /HTTP 400/.test(r.out) && /did not accept any of those requests/.test(r.out) && r.code === 0, r.out);
s.close();
s = await start(4105, { noEvents: true });
r = await run(4105, ["Drayton Wilson", "2026-10-08"]);
check("D: no events at all is reported, not crashed", /Events returned on this page: 0/.test(r.out) && /: 0\n/.test(r.out) && /none found/.test(r.out), r.out);
s.close();

check("every request in every scenario was a GET", methods.every((m) => m === "GET"));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
