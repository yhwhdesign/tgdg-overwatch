// Read-only SURVEY of every calendar event in Housecall Pro. It answers the questions that decide how
// the sync should treat events, without printing any titles, notes, addresses or people:
//   * does the same event id appear more than once (a repeating event's occurrences)?
//   * are there repeat rules, all-day events, or events with odd times, and what do they look like?
//   * is the list really newest-created-first, and how long BEFORE an event happens is it created?
//     (that tells us how far back we must read, instead of reading all of history every time)
//
//   node scripts/hcp-events-survey.mjs
//
// It reads every page (a minute or two) with GET requests only. Nothing is written anywhere.

import { readFileSync } from "node:fs";

try {
  process.loadEnvFile(".env");
} catch {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env */
  }
}

const BASE = process.env.HCP_BASE_URL || "https://api.housecallpro.com";
const KEY = process.env.HCP_API_KEY;
const TZ = process.env.BUSINESS_TIMEZONE || "America/Chicago";
if (!KEY) {
  console.error("HCP_API_KEY is empty. Add it to tools/dispatch-console/.env and run again.");
  process.exit(1);
}

const DAY = 86_400_000;
const now = Date.now();
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const local = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
};

let scheme = null;
async function get(path) {
  const order = scheme ? [scheme] : ["Token", "Bearer"];
  for (const s of order) {
    const res = await fetch(BASE + path, { headers: { Authorization: `${s} ${KEY}`, Accept: "application/json" } });
    if (res.status === 401 || res.status === 403) continue;
    scheme = s;
    const text = await res.text();
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000));
      return get(path);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path.split("?")[0]}: ${text.slice(0, 200)}`);
    return { json: JSON.parse(text), bytes: text.length };
  }
  throw new Error("HCP rejected the API key with both header styles.");
}
const firstArray = (json) => {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") for (const v of Object.values(json)) if (Array.isArray(v)) return v;
  return [];
};
const qs = (page) => `/events?start_date=${ymd(now)}&end_date=${ymd(now + 31 * DAY)}&page=${page}&page_size=100`;

console.error("Reading every event (read-only). This can take a minute or two...");
const startedAt = Date.now();
const heartbeat = setInterval(() => console.error(`  ...still reading (${Math.round((Date.now() - startedAt) / 1000)}s)`), 8000);

let totalPages = 1;
let totalItems = 0;
let bytes = 0;
const records = [];
const keep = (e) => {
  const sch = e && typeof e.schedule === "object" && e.schedule ? e.schedule : e;
  const rule = e.recurrence_rule;
  return {
    id: String(e.id ?? ""),
    start: sch.start_time ?? sch.start ?? null,
    end: sch.end_time ?? sch.end ?? null,
    allDay: e.all_day === true,
    rule: rule == null ? null : (typeof rule === "string" ? rule : JSON.stringify(rule)).slice(0, 120),
    created: e.created_at ?? null,
    assigned: Array.isArray(e.assigned_employees) ? e.assigned_employees.length : null,
  };
};
try {
  const first = await get(qs(1));
  bytes += first.bytes;
  totalPages = first.json.total_pages ?? 1;
  totalItems = first.json.total_items ?? 0;
  const pages = [firstArray(first.json).map(keep)];
  const remaining = Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2);
  for (let i = 0; i < remaining.length; i += 3) {
    const batch = remaining.slice(i, i + 3);
    const results = await Promise.all(batch.map((p) => get(qs(p))));
    results.forEach((r, j) => {
      bytes += r.bytes;
      pages[batch[j] - 1] = firstArray(r.json).map(keep);
    });
    if ((i / 3) % 5 === 4) console.error(`  ...read ${Math.min(batch[batch.length - 1], totalPages)} of ${totalPages} pages`);
  }
  for (const p of pages) records.push(...p);
} catch (err) {
  clearInterval(heartbeat);
  console.error(`Could not read the events: ${err.message}`);
  process.exit(1);
}
clearInterval(heartbeat);
const seconds = Math.round((Date.now() - startedAt) / 100) / 10;

const t = (v) => (v ? new Date(v).getTime() : NaN);
const out = (s = "") => console.log(s);
const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "0%");

out(`\n=== EVENT SURVEY   (read ${records.length} events in ${seconds}s, about ${Math.round(bytes / 1048576)} MB, ${totalPages} pages; HCP says total_items = ${totalItems})`);

// ---- duplicates
const byId = new Map();
for (const r of records) {
  if (!byId.has(r.id)) byId.set(r.id, []);
  byId.get(r.id).push(r);
}
const dupIds = [...byId.entries()].filter(([, list]) => list.length > 1);
out(`\n1. DISTINCT vs REPEATED ids`);
out(`   distinct ids: ${byId.size}   |   entries that repeat an earlier id: ${records.length - byId.size}   |   ids appearing more than once: ${dupIds.length}`);
let sameTimes = 0;
let differentTimes = 0;
for (const [, list] of dupIds) {
  if (new Set(list.map((r) => `${r.start}|${r.end}`)).size === 1) sameTimes++;
  else differentTimes++;
}
out(`   of those, identical copies (same times): ${sameTimes}   |   different occurrences (different times): ${differentTimes}`);
for (const [id, list] of dupIds.slice(0, 3)) {
  out(`   e.g. ...${id.slice(-6)} appears ${list.length}x: ${list.slice(0, 4).map((r) => `${r.start ?? "?"} to ${r.end ?? "?"}`).join("  |  ")}`);
}

// ---- repeat rules
const withRule = records.filter((r) => r.rule !== null);
out(`\n2. REPEAT RULES (recurrence_rule not null): ${withRule.length} of ${records.length}`);
for (const r of withRule.slice(0, 5)) {
  out(`   e.g. rule ${r.rule}   |   starts ${r.start ?? "?"} (${r.start ? local(r.start) : "?"})  ends ${r.end ?? "?"}   |   created ${r.created ?? "?"}   |   people=${r.assigned ?? "?"}   |   id ...${r.id.slice(-6)}`);
}
if (withRule.length > 0) {
  out(`   (a repeating event may be listed ONCE, at its first occurrence, so its later occurrences would not show up on their own)`);
}

// ---- all day
const allDay = records.filter((r) => r.allDay);
out(`\n3. ALL-DAY events (all_day = true): ${allDay.length}`);
for (const r of allDay.slice(0, 3)) out(`   e.g. start ${r.start}  end ${r.end}   (${local(r.start)} to ${local(r.end)})`);

// ---- odd times
const missing = records.filter((r) => !r.start || !r.end);
const equal = records.filter((r) => r.start && r.end && t(r.start) === t(r.end));
const backwards = records.filter((r) => r.start && r.end && t(r.end) < t(r.start));
out(`\n4. ODD TIMES: missing start or end: ${missing.length}   |   end equals start: ${equal.length}   |   end BEFORE start: ${backwards.length}`);
for (const [label, list] of [["end equals start", equal], ["end before start", backwards], ["missing", missing]]) {
  for (const r of list.slice(0, 3)) out(`   ${label}: start ${r.start}  end ${r.end}  all_day=${r.allDay}  rule=${r.rule ?? "none"}  created ${r.created ?? "?"}  people=${r.assigned ?? "?"}`);
}

// ---- ordering and age
let increases = 0;
for (let i = 1; i < records.length; i++) if (t(records[i].created) > t(records[i - 1].created)) increases++;
const created = records.map((r) => t(r.created)).filter((n) => Number.isFinite(n));
out(`\n5. ORDER: the list is newest-created-first? ${increases === 0 ? "YES, all the way down" : `NOT strictly (${increases} places where an older entry comes before a newer one)`}`);
out(`   newest created: ${created.length ? local(new Date(Math.max(...created)).toISOString()) : "?"}   |   oldest created: ${created.length ? local(new Date(Math.min(...created)).toISOString()) : "?"}`);

const windowStart = now;
const windowEnd = now + 31 * DAY;
const inWindow = records.filter((r) => r.start && r.end && t(r.end) > windowStart && t(r.start) < windowEnd);
out(`\n6. HOW FAR AHEAD ARE EVENTS CREATED?  (events that overlap the next 31 days: ${inWindow.length} entries, ${new Set(inWindow.map((r) => r.id)).size} distinct)`);
const ages = inWindow.map((r) => (now - t(r.created)) / DAY).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
for (const days of [7, 14, 30, 60, 90, 180, 365]) {
  const n = ages.filter((a) => a <= days).length;
  out(`   created within the last ${String(days).padStart(3)} days: ${String(n).padStart(4)} of ${ages.length} (${pct(n, ages.length)})`);
}
out(`   the OLDEST-created of them was created ${ages.length ? Math.round(ages[ages.length - 1]) : "?"} days ago`);
const dupInWindow = new Set(inWindow.map((r) => r.id)).size !== inWindow.length;
out(`   repeated ids among the next-31-days events? ${dupInWindow ? "YES" : "no"}`);

// ---- where the history sits (page-by-page), to size an early stop
out(`\n7. HOW MANY PAGES WOULD WE NEED?`);
let needed = 0;
for (let i = 0; i < records.length; i++) {
  if (inWindow.includes(records[i])) needed = i + 1;
}
out(`   the LAST entry (furthest down the list) that matters for the next 31 days is number ${needed} of ${records.length}, which is page ${Math.ceil(needed / 100) || 1} of ${totalPages}`);
// ---- can HCP narrow or sort the list for us?  (a handful of tiny requests: 3 events each)
out(`\n8. CAN HOUSECALL PRO SORT OR FILTER EVENTS FOR US?   (tiny test requests; the answer decides how little we have to read)`);
const todayDate = ymd(now);
const todayIso = new Date(now).toISOString();
const later = ymd(now + 31 * DAY);
const experiments = [
  ["nothing extra (the baseline)", ""],
  ["sort_by=created_at&sort_direction=desc  (control)", "sort_by=created_at&sort_direction=desc"],
  ["sort_by=start_time&sort_direction=desc", "sort_by=start_time&sort_direction=desc"],
  ["sort_by=scheduled_start&sort_direction=desc", "sort_by=scheduled_start&sort_direction=desc"],
  ["sort_by=start&sort_direction=desc", "sort_by=start&sort_direction=desc"],
  ["sort_by=schedule.start_time&sort_direction=desc", "sort_by=schedule.start_time&sort_direction=desc"],
  ["scheduled_start_min (the name jobs use)", `scheduled_start_min=${todayIso}`],
  ["scheduled_end_min", `scheduled_end_min=${todayIso}`],
  ["start_time_min", `start_time_min=${todayIso}`],
  ["start_min", `start_min=${todayIso}`],
  ["from and to", `from=${todayDate}&to=${later}`],
  ["start_date only (plain date, no end)", `start_date=${todayDate}`],
];
const probe = async (extra) => {
  const r = await get(`/events?page=1&page_size=3${extra ? `&${extra}` : ""}`);
  const list = firstArray(r.json).map(keep);
  return { total: r.json.total_items ?? list.length, list };
};
let baseline = null;
for (const [label, extra] of experiments) {
  let line;
  try {
    const { total, list } = await probe(extra);
    if (extra === "") baseline = { total, ids: list.map((e) => e.id).join() };
    const starts = list.map((e) => t(e.start));
    const descending = starts.length >= 2 && starts.every((n, i) => i === 0 || n < starts[i - 1]);
    const allFromToday = list.length > 0 && starts.every((n) => n >= now - DAY);
    const changedTotal = baseline && total !== baseline.total;
    const changedOrder = baseline && list.map((e) => e.id).join() !== baseline.ids;
    let verdict = "no effect (HCP ignored it)";
    if (extra === "") verdict = "(baseline)";
    else if (changedTotal && allFromToday) verdict = `FILTER WORKS: ${total} events instead of ${baseline.total}, all starting today or later`;
    else if (changedTotal) verdict = `narrows the list to ${total} (was ${baseline.total}) but the first events are not all from today on: check`;
    else if (changedOrder && descending && starts[0] > now) verdict = "SORTS BY START TIME, furthest-future first";
    else if (changedOrder) verdict = "reorders the list, but not by start time";
    out(`   ${label}`);
    out(`      -> ${verdict}   [total ${total}; first starts: ${list.map((e) => (e.start ? local(e.start) : "?")).join(" | ") || "none"}]`);
  } catch (err) {
    line = /HTTP (\d+)/.exec(err.message);
    out(`   ${label}`);
    out(`      -> refused (HTTP ${line ? line[1] : "error"})`);
  }
}
out(`   (a line that says FILTER WORKS or SORTS BY START TIME means we can read only today-forward events, safely)`);

out(`\nRead-only: nothing was written to HCP or to your database. No titles, notes, addresses or people were printed.`);
