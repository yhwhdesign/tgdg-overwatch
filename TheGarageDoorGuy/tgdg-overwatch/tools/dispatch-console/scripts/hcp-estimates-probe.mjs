// Read-only: what does Housecall Pro tell us about ESTIMATES in YOUR account?
// The Estimate Tracker needs to know which estimates are still open, which were approved or declined, how old they are,
// which tech made them, what they are worth, and which ones turned into a job. Only your real data can answer that:
//
//   node scripts/hcp-estimates-probe.mjs          (reads up to 10 pages of 100 estimates)
//   node scripts/hcp-estimates-probe.mjs 30       (reads up to 30 pages; 1 to 60)
//
// GET requests only; nothing is written anywhere. It prints:
//   1. whether the key works and how the estimate list is paged (and whether it is newest-first)
//   2. the SHAPE of an estimate (field names and kinds), and of its options
//   3. the status values you actually use (work_status, option approval_status) and how many estimates have each
//   4. how old your open estimates are, and how many are worth what (size buckets only)
//   5. how many estimates have a tech assigned and a schedule, and which fields hold them
//   6. how many recent jobs point back at an estimate (original_estimate_id), and how many of those estimates we saw
// Customer names, addresses, phone numbers, emails and notes are never printed. Staff names and your own status
// labels are. Skim the output before pasting it anywhere.

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

const args = process.argv.slice(2);
const pagesArg = args[0];
const maxPages = pagesArg === undefined ? 10 : Number(pagesArg);
if (args.length > 1 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 60) {
  console.error("Usage: node scripts/hcp-estimates-probe.mjs [pages of 100, 1 to 60]");
  process.exit(1);
}
if (!KEY) {
  console.error("HCP_API_KEY is empty. Add it to tools/dispatch-console/.env and run again.");
  process.exit(1);
}

// ---- helpers ------------------------------------------------------------------------------------------
const parse = (v) => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const top = (map, n = 15) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const pct = (n, of) => (of === 0 ? "-" : `${Math.round((n / of) * 100)}%`);
const firstArray = (json) => {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") for (const v of Object.values(json)) if (Array.isArray(v)) return v;
  return [];
};
function shapeOf(value) {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "string") return "text";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "true/false";
  if (Array.isArray(value)) return value.length === 0 ? "empty list" : `list of ${shapeOf(value[0])}`;
  return `object (${Object.keys(value).slice(0, 10).join(", ")})`;
}
// Fields that can hold customer details: shown by NAME only, never by value.
const PRIVATE = new Set(["customer", "address", "notes", "note", "description", "customer_name", "email", "phone"]);
// Housecall Pro amounts may be dollars or cents; the probe prints what it sees and a guess, never a customer.
const amountOf = (o) => (o && typeof o === "object" ? (typeof o.total_amount === "number" ? o.total_amount : typeof o.amount === "number" ? o.amount : null) : null);

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

// ---- 1. connection and paging -----------------------------------------------------------------------------
console.log("Housecall Pro Estimate probe (read-only)\n");
let scheme = null;
let first = null;
for (const candidate of ["Token", "Bearer"]) {
  const r = await get("/estimates?page=1&page_size=100", candidate);
  if (r.status >= 200 && r.status < 300) {
    scheme = candidate;
    first = r;
    break;
  }
  if (r.status === 404 || r.status === 403) {
    console.error(`GET /estimates answered ${r.status}.\nThe key may not be allowed to read estimates, or the address differs. Tell me this line.`);
    process.exit(1);
  }
}
if (!scheme) {
  console.error("HCP rejected the key with both header styles. Check HCP_API_KEY.");
  process.exit(1);
}
const meta = first.json && typeof first.json === "object" && !Array.isArray(first.json) ? Object.fromEntries(Object.entries(first.json).filter(([, v]) => !Array.isArray(v))) : {};
console.log(`1. Connection and paging\n   Authorization style that works: ${scheme}\n   Page-level fields (not the list itself): ${JSON.stringify(meta)}`);

const estimates = [];
let pages = 0;
let page = 1;
let totalPages = Number(meta.total_pages) || null;
for (;;) {
  const r = page === 1 ? first : await get(`/estimates?page=${page}&page_size=100`, scheme);
  if (r.status < 200 || r.status >= 300) {
    console.log(`   Stopped at page ${page}: HTTP ${r.status}`);
    break;
  }
  const list = firstArray(r.json);
  estimates.push(...list.filter((e) => e && typeof e === "object"));
  pages++;
  if (list.length < 100 || pages >= maxPages || (totalPages && page >= totalPages)) break;
  page++;
}
console.log(`   Read ${estimates.length} estimates in ${pages} page(s)${totalPages ? ` (the account reports ${totalPages} pages in all)` : ""}.`);
if (estimates.length === 0) {
  console.log("   No estimates came back: nothing more to show.");
  process.exit(0);
}
const created = estimates.map((e) => parse(e.created_at)).filter(Boolean).map((d) => d.getTime());
if (created.length > 1) {
  const newestFirst = created[0] >= created[created.length - 1];
  console.log(`   Order: ${newestFirst ? "newest first" : "oldest first"}; oldest read ${new Date(Math.min(...created)).toISOString().slice(0, 10)}, newest ${new Date(Math.max(...created)).toISOString().slice(0, 10)}`);
}

// ---- 2. shape --------------------------------------------------------------------------------------------
const sample = estimates.find((e) => e && typeof e === "object") ?? {};
console.log("\n2. Shape of an estimate (field: kind; customer details are named, never shown)");
for (const [k, v] of Object.entries(sample)) console.log(`   ${k}: ${PRIVATE.has(k) ? `${shapeOf(v)} [private, value hidden]` : shapeOf(v)}`);
const optionFields = new Map();
let optionCount = 0;
for (const e of estimates) for (const o of Array.isArray(e.options) ? e.options : []) {
  optionCount++;
  for (const [k, v] of Object.entries(o ?? {})) if (optionFields.size < 40) bump(optionFields, `${k}: ${shapeOf(v)}`);
}
console.log(`   Options (a quote can offer several): ${optionCount} across ${estimates.length} estimates`);
for (const [k, n] of top(optionFields, 20)) console.log(`     ${k}   (${n})`);

// ---- 3. status values ------------------------------------------------------------------------------------
console.log("\n3. Status values in use");
for (const field of ["work_status", "status", "estimate_status"]) {
  const m = new Map();
  for (const e of estimates) if (e[field] !== undefined) bump(m, typeof e[field] === "string" ? e[field] : shapeOf(e[field]));
  if (m.size) console.log(`   ${field}: ${top(m).map(([k, n]) => `${k} ${n}`).join(", ")}`);
}
const approval = new Map();
const optionsPer = new Map();
for (const e of estimates) {
  const opts = Array.isArray(e.options) ? e.options : [];
  bump(optionsPer, String(opts.length));
  for (const o of opts) bump(approval, typeof o?.approval_status === "string" ? o.approval_status : o?.approval_status == null ? "(none)" : shapeOf(o.approval_status));
}
console.log(`   option approval_status: ${top(approval).map(([k, n]) => `${k} ${n}`).join(", ") || "(no options)"}`);
console.log(`   options per estimate: ${top(optionsPer).map(([k, n]) => `${k} option(s) x ${n}`).join(", ")}`);

// ---- 4. ages and sizes -----------------------------------------------------------------------------------
console.log("\n4. How old, and how big (all estimates read)");
const now = Date.now();
const ageBuckets = [["under 3 days", 3], ["3 to 7 days", 7], ["8 to 14 days", 14], ["15 to 30 days", 30], ["31 to 90 days", 90], ["over 90 days", Infinity]];
const ages = new Map(ageBuckets.map(([l]) => [l, 0]));
for (const e of estimates) {
  const d = parse(e.created_at);
  if (!d) continue;
  const days = (now - d.getTime()) / 86_400_000;
  ages.set(ageBuckets.find(([, max]) => days < max)[0], ages.get(ageBuckets.find(([, max]) => days < max)[0]) + 1);
}
console.log(`   age since created: ${[...ages.entries()].map(([l, n]) => `${l} ${n}`).join(", ")}`);
const totals = estimates.map((e) => {
  const opts = Array.isArray(e.options) ? e.options : [];
  const amounts = opts.map(amountOf).filter((n) => n !== null);
  return amounts.length ? Math.max(...amounts) : null;
}).filter((n) => n !== null);
if (totals.length) {
  const sorted = [...totals].sort((a, b) => a - b);
  console.log(`   biggest option per estimate (raw numbers, so we learn dollars vs cents): min ${sorted[0]}, median ${sorted[Math.floor(sorted.length / 2)]}, max ${sorted[sorted.length - 1]}  (${totals.length} of ${estimates.length} have an amount)`);
} else {
  console.log("   no option amounts found under total_amount or amount: tell me this line");
}

// ---- 5. tech and schedule --------------------------------------------------------------------------------
console.log("\n5. Who made it, and when");
const withTech = estimates.filter((e) => Array.isArray(e.assigned_employees) && e.assigned_employees.length > 0).length;
const withSchedule = estimates.filter((e) => e.schedule && typeof e.schedule === "object" && Object.keys(e.schedule).length > 0).length;
console.log(`   with assigned_employees: ${withTech} of ${estimates.length} (${pct(withTech, estimates.length)})`);
console.log(`   with a schedule: ${withSchedule} of ${estimates.length}; schedule fields: ${sample.schedule ? Object.keys(sample.schedule).join(", ") : "(none on the sample)"}`);
const wts = estimates.filter((e) => e.work_timestamps && typeof e.work_timestamps === "object");
console.log(`   with work_timestamps: ${wts.length}${wts[0] ? `; fields: ${Object.keys(wts[0].work_timestamps).join(", ")}` : ""}`);
const names = new Map();
for (const e of estimates) for (const a of Array.isArray(e.assigned_employees) ? e.assigned_employees : []) bump(names, [a.first_name, a.last_name].filter(Boolean).join(" ") || String(a.id ?? "unknown"));
console.log(`   estimates per assigned tech: ${top(names, 12).map(([k, n]) => `${k} ${n}`).join(", ") || "(none)"}`);

// ---- 6. link to jobs -------------------------------------------------------------------------------------
console.log("\n6. Do jobs point back at estimates?");
const jobs = [];
for (let p = 1; p <= 5; p++) {
  const r = await get(`/jobs?page=${p}&page_size=100`, scheme);
  if (r.status < 200 || r.status >= 300) break;
  const list = firstArray(r.json);
  jobs.push(...list.filter((j) => j && typeof j === "object"));
  if (list.length < 100) break;
}
const estIds = new Set(estimates.map((e) => e.id).filter(Boolean));
const estUuids = new Set(estimates.flatMap((e) => [e.uuid, e.estimate_uuid].filter(Boolean)));
let linked = 0;
let found = 0;
for (const j of jobs) {
  const ids = [j.original_estimate_id, ...(Array.isArray(j.original_estimate_uuids) ? j.original_estimate_uuids : [])].filter(Boolean);
  if (ids.length === 0) continue;
  linked++;
  if (ids.some((id) => estIds.has(id) || estUuids.has(id))) found++;
}
console.log(`   jobs read: ${jobs.length}; with original_estimate_id/uuids: ${linked}; of those, the estimate was among the ${estimates.length} read: ${found}`);
console.log(`   estimate id looks like: ${String(sample.id ?? "").replace(/[0-9a-f]/gi, "x").slice(0, 40)}; a job's link looks like: ${String(jobs.find((j) => j.original_estimate_id)?.original_estimate_id ?? "(none)").replace(/[0-9a-f]/gi, "x").slice(0, 40)}`);
// ---- 7. labels: tags and option names (business labels such as "Jasen Est"; counts only, no customer data) -----
console.log("\n7. Labels on estimates and options (to find things like \"Jasen Est\" and \"*\")");
const optTags = new Map();
const optNames = new Map();
const estTags = new Map();
for (const e of estimates) {
  for (const t of Array.isArray(e.tags) ? e.tags : []) if (typeof t === "string") bump(estTags, t.slice(0, 60));
  for (const o of Array.isArray(e.options) ? e.options : []) {
    for (const t of Array.isArray(o?.tags) ? o.tags : []) if (typeof t === "string") bump(optTags, t.slice(0, 60));
    if (typeof o?.name === "string") bump(optNames, o.name.replace(/[0-9]+/g, "#").slice(0, 60));
  }
}
console.log(`   tags on the estimate itself: ${top(estTags, 25).map(([k, n]) => `"${k}" ${n}`).join(", ") || "(none)"}`);
console.log(`   tags on options: ${top(optTags, 40).map(([k, n]) => `"${k}" ${n}`).join(", ") || "(none)"}`);
console.log(`   option names (numbers shown as #): ${top(optNames, 20).map(([k, n]) => `"${k}" ${n}`).join(", ") || "(none)"}`);
const seeStar = estimates.filter((e) => (Array.isArray(e.options) ? e.options : []).some((o) => (Array.isArray(o?.tags) ? o.tags : []).some((t) => typeof t === "string" && /jasen/i.test(t)))).length;
console.log(`   estimates with any option tag containing "jasen": ${seeStar}`);
const kinds = new Map();
for (const e of estimates) for (const o of Array.isArray(e.options) ? e.options : []) bump(kinds, typeof o?.status === "string" ? o.status : "(none)");
console.log(`   option status values: ${top(kinds).map(([k, n]) => `${k} ${n}`).join(", ")}`);
console.log(`   work_timestamps.completed_at present: ${estimates.filter((e) => parse(e.work_timestamps?.completed_at)).length} of ${estimates.length}; created_at to completed_at is the visit length`);

console.log("\nDone. Copy everything above into the chat. Nothing private was printed.");
