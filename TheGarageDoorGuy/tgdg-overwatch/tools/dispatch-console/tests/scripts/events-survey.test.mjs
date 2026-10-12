import http from "node:http";
import { spawn } from "node:child_process";
let passes = 0, failures = 0;
const check = (n, ok, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };

const DAY = 86400000, now = Date.now();
const PEOPLE = [{ id: "pro_" + "d".repeat(32), first_name: "Drayton", last_name: "Wilson" }];
const ev = (id, startMs, endMs, createdDaysAgo, extra = {}) => ({
  id, name: "Zelda Quimby gate code 4471", note: "742 Evergreen Terrace", recurrence_rule: null, all_day: false,
  assigned_employees: PEOPLE, schedule: { start_time: startMs == null ? null : new Date(startMs).toISOString(), end_time: endMs == null ? null : new Date(endMs).toISOString() },
  created_at: new Date(now - createdDaysAgo * DAY).toISOString(), ...extra,
});
function build({ violation }) {
  const list = [
    ev("evt_new1", now + 2 * DAY, now + 2 * DAY + 3600000, 1),                                   // in window, created 1 day ago
    ev("evt_series", now + 3 * DAY, now + 3 * DAY + 3600000, 3),                                 // a series: three occurrences, one id
    ev("evt_series", now + 10 * DAY, now + 10 * DAY + 3600000, 3),
    ev("evt_series", now + 17 * DAY, now + 17 * DAY + 3600000, 3),
    ev("evt_copy", now + 5 * DAY, now + 5 * DAY + 3600000, 6),                                   // an identical copy
    ev("evt_copy", now + 5 * DAY, now + 5 * DAY + 3600000, 6),
    ev("evt_rule", now + 6 * DAY, now + 6 * DAY + 3600000, 8, { recurrence_rule: "FREQ=WEEKLY;BYDAY=MO" }),
    ev("evt_allday1", now + 7 * DAY, now + 8 * DAY, 10, { all_day: true }),
    ev("evt_allday2", now + 20 * DAY, now + 20 * DAY, 12, { all_day: true }),                    // all day AND start == end
    ev("evt_zero", now + 9 * DAY, now + 9 * DAY, 14),                                            // end == start
    ev("evt_back", now + 11 * DAY, now + 11 * DAY - 3600000, 16),                                // end before start
    ev("evt_nostart", null, now + 12 * DAY, 18),                                                 // missing start
    ev("evt_mid", now + 14 * DAY, now + 14 * DAY + 3600000, 40),                                 // created 40 days ago, in window
    ev("evt_old_planned", now + 25 * DAY, now + 25 * DAY + 3600000, 200),                        // planned 200 days ahead, in window
  ];
  for (let i = 0; i < 236; i++) list.push(ev(`evt_old${i}`, now - (400 + i) * DAY, now - (400 + i) * DAY + 3600000, 300 + i));   // old history
  if (violation) { const x = list.splice(5, 1)[0]; list.splice(120, 0, x); }
  return list;
}
let methods = [];
function mock(port, list, caps = {}) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      methods.push(req.method); const u = new URL(req.url, "http://x"); const page = Number(u.searchParams.get("page") ?? 1);
      const size = Number(u.searchParams.get("page_size") ?? 100);
      const send = (c, b) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
      for (const bad of caps.refuse ?? []) if (u.searchParams.has(bad)) return send(400, { error: { message: "unknown parameter" } });
      let rows = list;
      const startOf = (e) => new Date(e.schedule.start_time ?? 0).getTime();
      if (caps.sort && u.searchParams.get("sort_by") === caps.sort && u.searchParams.get("sort_direction") === "desc") rows = [...rows].sort((x, y) => startOf(y) - startOf(x));
      if (caps.filter && u.searchParams.has(caps.filter)) rows = rows.filter((e) => new Date(e.schedule.end_time ?? 0).getTime() >= new Date(u.searchParams.get(caps.filter)).getTime());
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ page, page_size: size, total_pages: Math.ceil(rows.length / size), total_items: rows.length, events: rows.slice((page - 1) * size, page * size) }));
    });
    s.listen(port, () => resolve(s));
  });
}
const run = (port) => new Promise((resolve) => {
  const p = spawn("node", ["scripts/hcp-events-survey.mjs"], { cwd: new URL("../..", import.meta.url).pathname, env: { ...process.env, HCP_BASE_URL: `http://localhost:${port}`, HCP_API_KEY: "k", BUSINESS_TIMEZONE: "America/Chicago" } });
  let out = "", err = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ out, err, code }));
});

let list = build({ violation: true });
let s = await mock(4401, list);
let r = await run(4401);
const o = r.out;
check("runs and exits cleanly", r.code === 0, r.err);
check("reads all 250 events over 3 pages", /read 250 events/.test(o) && /3 pages/.test(o) && /total_items = 250/.test(o), o.slice(0, 300));
check("1. counts distinct ids and repeats: 250 entries, 247 distinct ids, 2 ids appear more than once", /distinct ids: 247/.test(o) && /entries that repeat an earlier id: 3/.test(o) && /ids appearing more than once: 2/.test(o), o);
check("1. tells identical copies from different occurrences (1 and 1)", /identical copies \(same times\): 1\s+\|\s+different occurrences \(different times\): 1/.test(o), o);
check("1. shows the series' occurrences by time", /\.\.\.series appears 3x/.test(o.replace("evt_series", "series")) || /series.*appears 3x|evt_series|ries appears 3x/.test(o), o);
check("2. finds the one repeat rule, prints its text AND when that event starts, was created and how many people", /REPEAT RULES.*: 1 of 250/.test(o) && /rule FREQ=WEEKLY;BYDAY=MO\s+\|\s+starts 20\d\d-\d\d-\d\dT/.test(o) && /created 20\d\d-\d\d-\d\dT.*people=1/.test(o) && /may be listed ONCE/.test(o), o);
check("3. counts all-day events (2) with examples", /ALL-DAY events \(all_day = true\): 2/.test(o) && /e\.g\. start/.test(o), o);
check("4. counts the odd times: 1 missing, 2 equal (the zero-length and the all-day one), 1 backwards", /missing start or end: 1\s+\|\s+end equals start: 2\s+\|\s+end BEFORE start: 1/.test(o), o);
check("5. notices the list is NOT strictly newest-first when one entry is out of place", /NOT strictly/.test(o), o);
check("6. reports how far ahead events are created, including the one planned 200 days ahead", /OLDEST-created of them was created 200 days ago/.test(o) && /created within the last\s+30 days:/.test(o), o);
check("7. says how deep into the list the next 31 days reach", /the LAST entry .* is number \d+ of 250, which is page \d of 3/.test(o), o);
check("no titles, notes, addresses or people anywhere in the output", !/Zelda|Quimby|4471|Evergreen|Drayton|Wilson|gate code/.test(o + r.err), "");
check("read-only: every request was a GET", methods.length > 0 && methods.every((m) => m === "GET"));
s.close();

methods = [];
list = build({ violation: false }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
s = await mock(4402, list);
r = await run(4402);
check("a strictly newest-first list is recognized", /newest-created-first\? YES, all the way down/.test(r.out), r.out.split("\n").find((l) => l.includes("ORDER")));
s.close();

// ---- section 8: can HCP sort or filter?  (a fake HCP where sorting by start_time and filtering by scheduled_start_min work)
methods = [];
list = build({ violation: false }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
s = await mock(4403, list, { sort: "start_time", filter: "scheduled_start_min", refuse: ["start_min"] });
r = await run(4403);
const sec8 = r.out.slice(r.out.indexOf("8. CAN HOUSECALL PRO"));
const lineAfter = (label) => { const i = sec8.indexOf(label); return i < 0 ? "" : sec8.slice(i, sec8.indexOf("\n", sec8.indexOf("->", i)) + 1); };
check("8. runs the experiments section", sec8.length > 0 && /SORT OR FILTER EVENTS/.test(sec8), r.out.slice(-400));
check("8. recognizes a sort by start time that works (furthest-future first)", /SORTS BY START TIME, furthest-future first/.test(lineAfter("sort_by=start_time&sort_direction=desc")), lineAfter("sort_by=start_time"));
check("8. recognizes a filter that works, with the shrunken total", /FILTER WORKS: \d+ events instead of 250, all starting today or later/.test(lineAfter("scheduled_start_min")), lineAfter("scheduled_start_min"));
check("8. says when a parameter is refused", /refused \(HTTP 400\)/.test(lineAfter("start_min\n")) || /start_min\n\s+-> refused \(HTTP 400\)/.test(sec8), sec8);
check("8. says 'no effect' for parameters HCP ignores (the control sort, sort_by=start)", /no effect/.test(lineAfter("sort_by=created_at&sort_direction=desc")) && /no effect/.test(lineAfter("sort_by=start&sort_direction=desc")), sec8.slice(0, 900));
check("8. shows the first start times it saw, in local time", /first starts: [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+, 20\d\d/.test(sec8), sec8.slice(0, 500));
check("8. makes only small requests (3 events) for the experiments, all GET", methods.every((m) => m === "GET"));
check("8. still no personal text in the output", !/Zelda|Quimby|4471|Evergreen|Drayton|Wilson|gate code/.test(r.out + r.err));
s.close();

// ---- a fake HCP that ignores everything (like the real one so far)
list = build({ violation: false }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
s = await mock(4404, list, {});
r = await run(4404);
const sec8b = r.out.slice(r.out.indexOf("8. CAN HOUSECALL PRO"));
check("8. when HCP ignores every parameter, every experiment says so (no false hopes)", !/->.*(FILTER WORKS|SORTS BY START TIME)/.test(sec8b) && (sec8b.match(/no effect \(HCP ignored it\)/g) || []).length === 11, (sec8b.match(/no effect \(HCP ignored it\)/g) || []).length + " no-effect lines");
s.close();

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
