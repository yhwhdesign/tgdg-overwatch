// Read-only discovery for the Housecall Pro API. Run from tools/dispatch-console:
//
//   node scripts/hcp-probe.mjs
//
// What it does (GET requests only, nothing is written anywhere):
//   1. Works out which Authorization header style HCP accepts for your key
//      ("Token <key>" or "Bearer <key>").
//   2. Lists your employees (technicians) with their IDs.
//   3. Fetches a handful of jobs and prints the SHAPE of the response, so we
//      can map HCP's fields onto our Technician/Appointment tables.
//
// Privacy: values are masked (<string>, <number>) except an allowlist of
// scheduling fields and staff names. Customer names, addresses, phone numbers
// and emails are never printed. Still skim the output before pasting it anywhere.

import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    process.loadEnvFile(".env");
    return;
  } catch {
    /* fall through to manual parse */
  }
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env; rely on the real environment */
  }
}
loadEnv();

const BASE = process.env.HCP_BASE_URL || "https://api.housecallpro.com";
const KEY = process.env.HCP_API_KEY;

if (!KEY) {
  console.error("HCP_API_KEY is empty. Add it to tools/dispatch-console/.env and run again.");
  process.exit(1);
}

async function hcpGet(path, scheme) {
  const res = await fetch(BASE + path, {
    headers: { Authorization: `${scheme} ${KEY}`, Accept: "application/json" },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

// ---- masking / structure printing ------------------------------------------

const PAGINATION_KEYS = /^(page|page_size|total_pages|total_items|total_count|per_page)$/;
const TIMEY = /(start|end|arrival|window|status|schedule|^id$)/i;

function shouldShowValue(path) {
  const key = path.split(".").pop().replace(/\[\]$/, "");
  if (PAGINATION_KEYS.test(path)) return true;
  // Staff names are fine; customer names must never appear.
  if (/employee|pro\b|technician/i.test(path) && /^(id|first_name|last_name|name|role)$/.test(key)) return true;
  if (/^(jobs|appointments|data)\[\]\.(id|work_status)$/.test(path)) return true;
  if (/(schedule|appointment|arrival|window)/i.test(path) && TIMEY.test(key)) return true;
  return false;
}

function flatten(value, path, out) {
  if (Array.isArray(value)) {
    out.push({ path: `${path}[]`, note: `array, ${value.length} item(s) on this page` });
    if (value.length > 0) flatten(value[0], `${path}[]`, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      flatten(v, path ? `${path}.${k}` : k, out);
    }
    return;
  }
  const show = shouldShowValue(path);
  let rendered;
  if (value === null) rendered = "null";
  else if (show) rendered = JSON.stringify(value);
  else rendered = `<${typeof value}>`;
  out.push({ path, value: rendered });
}

function printShape(title, json) {
  console.log(`\n=== ${title}`);
  const out = [];
  flatten(json, "", out);
  for (const row of out) {
    if (row.note) console.log(`  ${row.path}   (${row.note})`);
    else console.log(`  ${row.path}: ${row.value}`);
  }
}

function firstArray(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    for (const v of Object.values(json)) if (Array.isArray(v)) return v;
  }
  return [];
}

function printRateLimitHeaders(headers) {
  const lines = [];
  for (const [k, v] of headers.entries()) {
    if (/ratelimit|retry-after/i.test(k)) lines.push(`  ${k}: ${v}`);
  }
  if (lines.length) {
    console.log("\n=== Rate limit headers");
    console.log(lines.join("\n"));
  }
}

// ---- run -------------------------------------------------------------------

console.log(`Probing ${BASE} (read-only)`);

let scheme = null;
let employeesRes = null;
for (const candidate of ["Token", "Bearer"]) {
  const r = await hcpGet("/employees?page=1&page_size=50", candidate);
  console.log(`  Authorization: ${candidate} ...  ->  HTTP ${r.status}`);
  if (r.status >= 200 && r.status < 300) {
    scheme = candidate;
    employeesRes = r;
    break;
  }
  if (r.status !== 401 && r.status !== 403) {
    console.log(`  Unexpected response body (first 300 chars): ${r.text.slice(0, 300)}`);
  }
}

if (!scheme) {
  console.error(
    "\nNeither header style worked. Check that the key was copied in full, that it is not revoked, " +
      "and that the account is on the MAX plan. Paste me the HTTP statuses above."
  );
  process.exit(1);
}
console.log(`\nAuth OK: HCP accepts "Authorization: ${scheme} <key>".`);

const employees = firstArray(employeesRes.json);
console.log(`\n=== Employees returned: ${employees.length}`);
for (const e of employees) {
  const name = [e.first_name, e.last_name].filter(Boolean).join(" ") || e.name || "(no name field)";
  console.log(`  - ${name}   id=${e.id}   role=${e.role ?? e.permissions ?? "?"}`);
}
printShape("Employees response shape", employeesRes.json);

const jobsRes = await hcpGet("/jobs?page=1&page_size=5", scheme);
console.log(`\nGET /jobs?page=1&page_size=5  ->  HTTP ${jobsRes.status}`);
if (jobsRes.status >= 200 && jobsRes.status < 300) {
  printShape("Jobs response shape (first 5 jobs)", jobsRes.json);
  const jobs = firstArray(jobsRes.json);
  const firstId = jobs[0]?.id;
  if (firstId) {
    const apptRes = await hcpGet(`/jobs/${encodeURIComponent(firstId)}/appointments`, scheme);
    console.log(`\nGET /jobs/{id}/appointments  ->  HTTP ${apptRes.status}`);
    if (apptRes.status >= 200 && apptRes.status < 300) {
      printShape("Appointments response shape (for the first job)", apptRes.json);
    }
  } else {
    console.log("\n(No jobs on this page, so the appointments shape wasn't probed.)");
  }
  printRateLimitHeaders(jobsRes.headers);
} else {
  console.log(`  Body (first 300 chars): ${jobsRes.text.slice(0, 300)}`);
}

console.log("\nDone. Read-only: nothing was written to HCP or to your database.");
