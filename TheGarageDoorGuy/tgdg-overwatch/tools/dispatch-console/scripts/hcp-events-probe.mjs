// Read-only: how does Housecall Pro describe calendar EVENTS (errands, time off, meetings)?
// Events are a different kind of calendar item than jobs, which is why a "go get product" event
// on a tech's morning does not show up as booked time in our console yet.
//
//   node scripts/hcp-events-probe.mjs "Drayton Wilson" 2026-10-08            (date optional, default tomorrow)
//   node scripts/hcp-events-probe.mjs "Drayton Wilson" 2026-10-08 --titles   (also print each event's title)
//
// GET requests only; nothing is written anywhere. It prints:
//   1. which way of asking HCP for events worked
//   2. the SHAPE of an event (field names), so we can read them properly
//   3. that person's events on that day: when, and where in the data they are attached to him
// Event titles, descriptions and notes are hidden unless you add --titles (they can mention customers).
// Staff names, times and field names are always shown.

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

const argv = process.argv.slice(2);
const showTitles = argv.includes("--titles");
const [query, dateArg] = argv.filter((a) => !a.startsWith("--"));
if (!query) {
  console.error('Usage: node scripts/hcp-events-probe.mjs "Drayton Wilson" [YYYY-MM-DD] [--titles]');
  process.exit(1);
}
if (!KEY) {
  console.error("HCP_API_KEY is empty. Add it to tools/dispatch-console/.env and run again.");
  process.exit(1);
}

const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const date = dateArg || ymd(new Date(Date.now() + 24 * 60 * 60 * 1000));
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("The date must look like 2026-10-08.");
  process.exit(1);
}
const nextDate = ymd(new Date(new Date(`${date}T12:00:00Z`).getTime() + 24 * 60 * 60 * 1000));
const local = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
};

async function get(path, scheme) {
  const res = await fetch(BASE + path, { headers: { Authorization: `${scheme} ${KEY}`, Accept: "application/json" } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}

const firstArray = (json) => {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") for (const v of Object.values(json)) if (Array.isArray(v)) return v;
  return [];
};

// ---- who -------------------------------------------------------------------
let scheme = null;
let empRes = null;
for (const candidate of ["Token", "Bearer"]) {
  const r = await get("/employees?page=1&page_size=100", candidate);
  if (r.status >= 200 && r.status < 300) {
    scheme = candidate;
    empRes = r;
    break;
  }
}
if (!scheme) {
  console.error("HCP rejected the key with both header styles. Check HCP_API_KEY.");
  process.exit(1);
}
const employees = firstArray(empRes.json);
const fullName = (e) => [e.first_name, e.last_name].filter(Boolean).join(" ");
const nameById = new Map(employees.map((e) => [e.id, fullName(e) || e.id]));
const norm = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
const matches = employees.filter((e) => norm(fullName(e)).includes(norm(query)));
if (matches.length !== 1) {
  console.error(
    matches.length === 0
      ? `No employee matches "${query}". People: ${employees.map(fullName).join(", ")}.`
      : `More than one person matches "${query}": ${matches.map(fullName).join(", ")}. Use the full name.`
  );
  process.exit(1);
}
const person = matches[0];

// ---- ask for events, trying the plausible ways until one works --------------
const attempts = [
  { label: "date range as plain dates", qs: `start_date=${date}&end_date=${nextDate}&page=1&page_size=100` },
  { label: "date range as full timestamps", qs: `start_date=${date}T00:00:00Z&end_date=${nextDate}T00:00:00Z&page=1&page_size=100` },
  { label: "NO date filter (first page only, just to see the shape)", qs: "page=1&page_size=25" },
];
let used = null;
let evRes = null;
console.log(`\nAsking HCP for events (${person.first_name} ${person.last_name}, ${date}, times in ${TZ})`);
for (const a of attempts) {
  const r = await get(`/events?${a.qs}`, scheme);
  console.log(`  ${a.label}: HTTP ${r.status}`);
  if (r.status >= 200 && r.status < 300) {
    used = a;
    evRes = r;
    break;
  }
}
if (!used) {
  console.log("\nHCP did not accept any of those requests for /events. Paste me the lines above.");
  process.exit(0);
}
const filtered = !used.label.startsWith("NO date filter");
const events = firstArray(evRes.json);

// ---- shape (field names), with text hidden --------------------------------
const HIDE = /^(name|title|description|notes?|note|body|text|summary|subject|location|address.*|email|phone.*|mobile.*)$/i;
const SHOW_VALUE = /(^id$|start|end|time|date|all.?day|duration|recur|repeat|rrule|frequency|interval|employee|assigned|pro_?|first_name|last_name|status|type|kind|color|created|updated|deleted|cancel)/i;

function flatten(value, path, out) {
  if (Array.isArray(value)) {
    out.push({ path: `${path}[]`, note: `array, ${value.length} item(s)` });
    if (value.length > 0) flatten(value[0], `${path}[]`, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
    return;
  }
  const key = path.split(".").pop().replace(/\[\]$/, "");
  let rendered;
  if (value === null) rendered = "null";
  else if (HIDE.test(key) && !showTitles) rendered = `<${typeof value}, hidden>`;
  else if (SHOW_VALUE.test(key)) rendered = JSON.stringify(value);
  else rendered = `<${typeof value}>`;
  out.push({ path, value: rendered });
}

console.log(`\nWorked: ${used.label}.${filtered ? "" : " (The date filter was not accepted, so these are NOT limited to the day.)"}`);
console.log(`Top-level fields in the answer: ${evRes.json && typeof evRes.json === "object" && !Array.isArray(evRes.json) ? Object.keys(evRes.json).join(", ") : "(a plain list)"}`);
console.log(`Events returned on this page: ${events.length}`);
if (events.length > 0) {
  console.log("\n=== Shape of one event (field names; text hidden unless --titles)");
  const rows = [];
  flatten(events[0], "event", rows);
  for (const r of rows) console.log(r.note ? `  ${r.path}   (${r.note})` : `  ${r.path}: ${r.value}`);
}

// ---- the person's events ---------------------------------------------------
function pathsContaining(value, needle, path = "event", found = []) {
  if (typeof value === "string") {
    if (value === needle) found.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((v) => pathsContaining(v, needle, `${path}[]`, found));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) pathsContaining(v, needle, `${path}.${k}`, found);
  }
  return found;
}
function timesIn(value, path = "", found = []) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) timesIn(v, path ? `${path}.${k}` : k, found);
  } else if (typeof value === "string" && /start|end|from|until|to$/i.test(path.split(".").pop()) && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    found.push({ field: path, raw: value });
  }
  return found;
}
const recurKeys = (value, found = new Set()) => {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (/recur|repeat|rrule|frequency|series/i.test(k)) found.add(k);
      recurKeys(v, found);
    }
  }
  return found;
};

const mine = events.filter((e) => JSON.stringify(e).includes(person.id));
console.log(`\n=== ${person.first_name} ${person.last_name}'s events${filtered ? ` on ${date}` : " (in this unfiltered page)"}: ${mine.length}`);
if (mine.length === 0) {
  console.log("  none found. If you KNOW he has one that day, tell me its time and I will look another way.");
}
mine.forEach((e, i) => {
  const tail = String(e.id ?? "?").slice(-6);
  console.log(`  ${i + 1}. event ...${tail}`);
  for (const t of timesIn(e)) console.log(`     ${t.field}: ${t.raw}   =  ${local(t.raw)}`);
  for (const p of pathsContaining(e, person.id)) console.log(`     he is attached at: ${p}`);
  const others = [...new Set(JSON.stringify(e).match(/pro_[0-9a-f]{32}/g) ?? [])].filter((id) => id !== person.id);
  if (others.length) console.log(`     also on it: ${others.map((id) => nameById.get(id) ?? id).join(", ")}`);
  const recur = [...recurKeys(e)];
  if (recur.length) console.log(`     recurrence-related fields present: ${recur.join(", ")}`);
  if (showTitles) console.log(`     title: ${e.name ?? e.title ?? e.description ?? "(none)"}`);
});

console.log("\nDone. Read-only: nothing was written to HCP or to your database.");
