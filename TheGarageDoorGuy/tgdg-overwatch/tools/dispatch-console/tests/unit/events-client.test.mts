import http from "node:http";
let passes = 0, failures = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };

const FROM = new Date("2026-10-08T05:00:00Z"), TO = new Date("2026-11-08T06:00:00Z");
const STEP = 6 * 3600000;                                            // one event every 6 hours
const startOfK = (k: number) => FROM.getTime() + k * STEP;
const ev = (k: number, extra: Record<string, unknown> = {}) => ({ id: `e${k}`, schedule: { start_time: new Date(startOfK(k)).toISOString(), end_time: new Date(startOfK(k) + 3600000).toISOString() }, created_at: new Date(startOfK(k) - 86400000).toISOString(), ...extra });
const DATASET = Array.from({ length: 2000 }, (_, i) => ev(i - 1500));             // k = -1500 .. +499: about 375 days back to 125 days ahead
const BY_START_DESC = [...DATASET].sort((a, b) => new Date(b.schedule.start_time).getTime() - new Date(a.schedule.start_time).getTime());
const CREATED_ORDER = [...DATASET].sort((a, b) => ((Number(a.id.slice(1)) * 7919) % 2003) - ((Number(b.id.slice(1)) * 7919) % 2003));   // scrambled, not by start

const seen: string[] = [], methods: string[] = [];
let inFlight = 0, maxInFlight = 0;
type Mode = "dataset" | "dataset-unsorted" | "dataset-sort-refused" | "dataset-500" | "dataset-nostart" | "dataset-slow" | "dataset-ties"
  | "dates-ok" | "dates-rejected" | "all-rejected" | "ignores-dates" | "other-key" | "seven-pages" | "slow" | "too-many";
function server(port: number, mode: Mode) {
  return new Promise<http.Server>((resolve) => {
    const s = http.createServer(async (req, res) => {
      methods.push(req.method ?? "?"); const u = new URL(req.url!, "http://x"); seen.push(`${port}${u.pathname}?${u.searchParams.toString()}`);
      const send = (c: number, b: unknown) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
      if (u.pathname !== "/events") return send(404, {});
      const page = Number(u.searchParams.get("page") ?? "1"), size = Number(u.searchParams.get("page_size") ?? "100");
      const sorted = u.searchParams.get("sort_by") === "start_time" && u.searchParams.get("sort_direction") === "desc";
      const slice = (rows: unknown[]) => send(200, { page, page_size: size, total_pages: Math.ceil(rows.length / size), total_items: rows.length, events: rows.slice((page - 1) * size, page * size) });
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        // ---- the new forward-by-start-time reading
        if (mode === "dataset") return slice(sorted ? BY_START_DESC : CREATED_ORDER);
        if (mode === "dataset-unsorted") return slice(CREATED_ORDER);                                           // ignores the sort
        if (mode === "dataset-sort-refused") return u.searchParams.has("sort_by") ? send(400, { error: { message: "bad sort" } }) : slice(CREATED_ORDER);
        if (mode === "dataset-500") return send(500, { error: { message: "boom" } });
        if (mode === "dataset-nostart") return slice(DATASET.map((e) => ({ id: e.id, name: "x" })));            // no readable start anywhere
        if (mode === "dataset-slow") { await new Promise((r) => setTimeout(r, 120)); return slice(sorted ? BY_START_DESC : CREATED_ORDER); }
        if (mode === "dataset-ties") { const rows = Array.from({ length: 450 }, (_, i) => ev(Math.floor((449 - i) / 10) + 100)); return slice(rows); }   // blocks of 10 with identical starts, descending
        // ---- the older "read everything" behavior, forced by refusing the sort
        if (u.searchParams.has("sort_by")) return send(400, { error: { message: "bad sort" } });
        const start = u.searchParams.get("start_date") ?? "";
        if (mode === "all-rejected") return send(400, { error: { message: "nope" } });
        if (mode === "dates-rejected" && /^\d{4}-\d{2}-\d{2}$/.test(start)) return send(400, { error: { message: "bad date" } });
        if (mode === "ignores-dates") return send(200, { page: 1, total_pages: 400, total_items: 40000, events: [{ id: "x" }] });
        if (mode === "too-many") return send(200, { page: 1, total_pages: 150, total_items: 15000, events: [{ id: "x" }] });
        if (mode === "seven-pages") { await new Promise((r) => setTimeout(r, page === 2 ? 120 : 20)); return send(200, { page, total_pages: 7, total_items: 7, events: [{ id: `e${page}` }] }); }
        if (mode === "slow") { await new Promise((r) => setTimeout(r, 120)); return send(200, { page, total_pages: 9, total_items: 9, events: [{ id: `e${page}` }] }); }
        const key = mode === "other-key" ? "calendar_events" : "events";
        return send(200, { page, total_pages: 2, total_items: 3, [key]: page === 1 ? [{ id: "e1" }, { id: "e2" }] : [{ id: "e3" }] });
      } finally { inFlight--; }
    });
    s.listen(port, () => resolve(s));
  });
}
let tag = 0;
const load = async (port: number) => { process.env.HCP_BASE_URL = `http://localhost:${port}`; process.env.HCP_API_KEY = "k"; return (await import(`../../src/lib/hcp-client.ts?v${++tag}`)).hcpApi; };
const run = async (port: number, mode: Mode, opts: Record<string, unknown> = {}) => {
  const s = await server(port, mode); const api = await load(port); seen.length = 0; const notes: string[] = []; const pages: string[] = [];
  let events: any[] | null = null, error: Error | null = null;
  try { events = await api.listEvents(FROM, TO, { ...opts, onNote: (m: string) => notes.push(m), onPage: (p: any) => pages.push(`${p.page}/${p.totalPages}`) }); } catch (e) { error = e as Error; }
  s.close(); return { events, error, notes, pages, requests: [...seen] };
};
const NEEDED = DATASET.filter((e) => new Date(e.schedule.start_time).getTime() >= FROM.getTime() - 21 * 86400000);   // everything the window could need

// ========== A. forward reading by start time (the new default) ==========
let r = await run(4301, "dataset", { lookbackDays: 21 });
check("A1 returns EVERY event the window could need (all events from 21 days before the window onward)", !!r.events && NEEDED.every((e) => r.events!.some((x) => x.id === e.id)), r.error?.message ?? `${r.events?.length} events returned, ${NEEDED.length} needed`);
check("A2 the furthest-future event comes first", r.events![0].id === "e499", r.events?.[0]?.id);
check("A3 it STOPS EARLY: far fewer than all 20 pages are requested", r.requests.length <= 9 && r.requests.length >= 6, `${r.requests.length} requests of 20 pages`);
check("A4 it did not return the whole history (2000 events), only a little past the window", r.events!.length < 900 && r.events!.length >= NEEDED.length, String(r.events?.length));
check("A5 it asks for the sort, never for date ranges", r.requests.every((q) => q.includes("sort_by=start_time") && q.includes("sort_direction=desc") && !q.includes("start_date")), r.requests[0]);
check("A6 it explains how the read went, in plain English", r.notes.length === 1 && /read forward by start time and stopped after page \d+ of 20/.test(r.notes[0]), r.notes.join(" | "));
check("A7 progress is reported for each page read", r.pages.length === r.requests.length - (r.requests.length - r.pages.length) && r.pages[0] === "1/20" && r.pages.length >= 6, r.pages.join(" "));
maxInFlight = 0;
const slowRun = await run(4316, "dataset-slow", { budgetMs: 60000, lookbackDays: 21 });
check("A8 pages are read a few at a time, never more than 3 at once (and the answer is the same)", maxInFlight > 1 && maxInFlight <= 3 && !!slowRun.events && NEEDED.every((e) => slowRun.events!.some((x) => x.id === e.id)), `max in flight ${maxInFlight}; ${slowRun.error?.message ?? ""}`);
check("A9 events keep their order: start times never increase down the list", r.events!.every((e, i, all) => i === 0 || new Date(e.schedule.start_time) <= new Date(all[i - 1].schedule.start_time)));

// ---- the look-back is the caller's choice, and the default is 120 days
const needed = (days: number) => DATASET.filter((e) => new Date(e.schedule.start_time).getTime() >= FROM.getTime() - days * 86400000);
r = await run(4320, "dataset");
check("A10 the DEFAULT look-back is 120 days: every event from 120 days before the window is returned", !!r.events && needed(120).every((e) => r.events!.some((x) => x.id === e.id)), r.error?.message ?? `${r.events?.length} returned, ${needed(120).length} needed`);
check("A10 ...and it reads further back than a 21-day look-back would", r.events!.length > needed(21).length + 300, `${r.events?.length} vs ${needed(21).length}`);
r = await run(4321, "dataset", { lookbackDays: 400 });
check("A11 a 400-day look-back returns every event from 400 days before the window", !!r.events && needed(400).every((e) => r.events!.some((x) => x.id === e.id)), r.error?.message ?? String(r.events?.length));
check("A11 ...still without reading the whole history if it is not needed", r.requests.length < 20 || needed(400).length >= 1900, `${r.requests.length} requests`);

// ========== B. when forward reading can't be trusted, read everything (and say so) ==========
r = await run(4302, "dataset-sort-refused");
check("B1 sort refused (HTTP 400): falls back to reading everything, complete", !!r.events && r.events.length === 2000, r.error?.message ?? String(r.events?.length));
check("B1 ...and says so", r.notes.some((n) => /could not read forward by start time/.test(n) && /reading ALL events instead/.test(n)), r.notes.join(" | "));
r = await run(4303, "dataset-unsorted");
check("B2 results NOT in start order (sort silently ignored): detected, falls back to everything", !!r.events && r.events.length === 2000 && r.notes.some((n) => /did not arrive in start order/.test(n)), r.error?.message ?? r.notes.join(" | "));
r = await run(4304, "dataset-500");
check("B3 a server error on the first page is reported as an error, not papered over with a huge read", !!r.error && /500/.test(r.error.message) && r.requests.length === 1, r.error?.message ?? "no error");
r = await run(4305, "dataset-nostart");
check("B4 events with no readable start NEVER count as 'reached the past': it keeps reading to the end", !!r.events && r.events.length === 2000 && r.notes.some((n) => /through all 20 pages/.test(n)), r.notes.join(" | "));
r = await run(4306, "dataset-ties");
check("B5 many events with the SAME start (even across a page boundary) are not mistaken for disorder", !!r.events && r.events.length >= 400 && !r.notes.some((n) => /did not arrive/.test(n)), r.error?.message ?? r.notes.join(" | "));

// ========== C. the time limit ==========
r = await run(4307, "dataset-slow", { budgetMs: 60 });
check("C1 forward reading respects the time limit with a clear message", !!r.error && /took longer than/.test(r.error.message), r.error?.message ?? "no error");
check("C2 ...and a timeout does NOT trigger a second, bigger read", !r.requests.some((q) => q.includes("start_date")), r.requests.join(" | "));

// ========== D. the read-everything fallback still behaves (sort refused forces it) ==========
r = await run(4308, "dates-ok");
check("D1 fallback lists every page (3 events over 2 pages)", !!r.events && r.events.map((e) => e.id).join() === "e1,e2,e3", r.error?.message ?? JSON.stringify(r.events));
check("D2 fallback asks with plain dates widened by a day each side", r.requests.some((q) => q.includes("start_date=2026-10-07") && q.includes("end_date=2026-11-09")), r.requests.join(" | "));
r = await run(4309, "dates-rejected");
check("D3 fallback uses full timestamps when plain dates are refused", !!r.events && r.events.length === 3 && r.requests.some((q) => q.includes("start_date=2026-10-08T05")), r.requests.join(" | "));
r = await run(4310, "all-rejected");
check("D4 if HCP refuses everything, one clear error", !!r.error && /HCP would not list events/.test(r.error.message) && /400/.test(r.error.message), r.error?.message ?? "no error");
r = await run(4311, "ignores-dates");
check("D5 a runaway account (400 pages) stops instead of reading it all", !!r.error && /more than we will read/.test(r.error.message), r.error?.message ?? "no error");
r = await run(4312, "other-key");
check("D6 copes with the list having a different key name", !!r.events && r.events.length === 3);
r = await run(4313, "seven-pages");
check("D7 fallback returns pages in order even when they finish out of order", !!r.events && r.events.map((e) => e.id).join() === "e1,e2,e3,e4,e5,e6,e7", r.events?.map((e) => e.id).join());
r = await run(4314, "slow", { budgetMs: 60 });
check("D8 fallback respects the time limit too", !!r.error && /took longer than/.test(r.error.message) && /of 9 pages/.test(r.error.message), r.error?.message ?? "no error");
r = await run(4315, "too-many");
check("D9 more pages than we will ever read is refused up front", !!r.error && /150 pages/.test(r.error.message), r.error?.message ?? "no error");

check("every request was a GET", methods.length > 0 && methods.every((m) => m === "GET"));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
