// Read-only: where does Housecall Pro keep the id that appears in an estimate's web address?
// The "Go to estimate" button opens https://pro.housecallpro.com/app/estimates/<id>. The web address holds an id that
// starts with "est_", while the estimate list's own "id" starts with something else, so we need to know which field has it.
//
//   node scripts/hcp-find-id.mjs "https://pro.housecallpro.com/app/estimates/est_65dd...."   (reads up to 20 pages)
//   node scripts/hcp-find-id.mjs est_65dd.... 60                                              (reads up to 60 pages; 1 to 140)
//
// GET requests only; nothing is written. It prints, for the id you give and for the whole sample, WHICH FIELD holds
// ids that start with "est_" (field names and counts only). Customer names, addresses, phone numbers, emails and notes
// are never printed, and ids are shown shortened.

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
const given = args[0] ?? "";
const idMatch = given.match(/\b([a-z]{2,4}_[A-Za-z0-9]{8,64})\b/);
const maxPages = args[1] === undefined ? 20 : Number(args[1]);
if (args.length < 1 || args.length > 2 || !idMatch || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 140) {
  console.error('Usage: node scripts/hcp-find-id.mjs "<estimate web address or its id>" [pages of 100, 1 to 140]');
  process.exit(1);
}
if (!KEY) {
  console.error("HCP_API_KEY is empty. Add it to tools/dispatch-console/.env and run again.");
  process.exit(1);
}
const target = idMatch[1];
const short = (s) => (typeof s === "string" && s.length > 10 ? `${s.slice(0, s.indexOf("_") + 1)}${s.slice(s.indexOf("_") + 1, s.indexOf("_") + 5)}...` : String(s));

const PRIVATE = new Set(["customer", "address", "notes", "note", "description", "customer_name", "email", "phone"]);

// every string value that looks like an id, with the field path it sits at (array positions shown as [])
function idsIn(value, path, out) {
  if (typeof value === "string") {
    if (/^[a-z]{2,4}_[A-Za-z0-9]{8,64}$/.test(value)) out.push({ path, value });
  } else if (Array.isArray(value)) {
    for (const v of value) idsIn(v, `${path}[]`, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (PRIVATE.has(k)) continue;
      idsIn(v, path ? `${path}.${k}` : k, out);
    }
  }
}

async function get(path, scheme) {
  const res = await fetch(BASE + path, { headers: { Authorization: `${scheme} ${KEY}`, Accept: "application/json" } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json };
}
const firstArray = (json) => {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") for (const v of Object.values(json)) if (Array.isArray(v)) return v;
  return [];
};

console.log(`Housecall Pro id finder (read-only)\nLooking for ${short(target)}\n`);
let scheme = null;
let firstPage = null;
for (const candidate of ["Token", "Bearer"]) {
  const r = await get("/estimates?page=1&page_size=100", candidate);
  if (r.status >= 200 && r.status < 300) {
    scheme = candidate;
    firstPage = r;
    break;
  }
  if (r.status === 404 || r.status === 403) {
    console.error(`GET /estimates answered ${r.status}. The key may not be allowed to read estimates.`);
    process.exit(1);
  }
}
if (!scheme) {
  console.error("HCP rejected the key with both header styles. Check HCP_API_KEY.");
  process.exit(1);
}

const prefixCounts = new Map(); // "path -> prefix" counts across the whole sample
const found = [];
let scanned = 0;
let page = 1;
let current = firstPage;
for (; page <= maxPages; page++) {
  if (page > 1) {
    current = await get(`/estimates?page=${page}&page_size=100`, scheme);
    if (current.status < 200 || current.status >= 300) break;
  }
  const list = firstArray(current.json).filter((e) => e && typeof e === "object");
  if (list.length === 0) break;
  for (const e of list) {
    scanned += 1;
    const ids = [];
    idsIn(e, "", ids);
    for (const { path, value } of ids) {
      const key = `${path || "(top)"} starts with ${value.slice(0, value.indexOf("_") + 1)}`;
      prefixCounts.set(key, (prefixCounts.get(key) ?? 0) + 1);
      if (value === target) found.push({ path: path || "(top)", topKeys: Object.keys(e).filter((k) => !PRIVATE.has(k)).slice(0, 40) });
    }
  }
  if (found.length > 0) break;
  const total = Number(current.json?.total_pages);
  if (Number.isFinite(total) && page >= total) break;
}

console.log(`1. Estimates read: ${scanned}${found.length ? "" : " (the one you gave was NOT among them)"}`);
if (found.length > 0) {
  console.log("\n2. FOUND. The id from the web address is stored at:");
  for (const f of found) console.log(`   ${f.path}`);
  console.log(`   Fields on that estimate: ${found[0].topKeys.join(", ")}`);
}
console.log("\n3. Where ids appear in the estimates read (field and how the id starts, with counts):");
for (const [k, n] of [...prefixCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`   ${n}x  ${k}`);

// the estimate may also be reachable directly by that id
const direct = await get(`/estimates/${encodeURIComponent(target)}`, scheme);
console.log(`\n4. Asking Housecall Pro for /estimates/${short(target)} directly: ${direct.status}`);
if (direct.status >= 200 && direct.status < 300 && direct.json && typeof direct.json === "object") {
  const ids = [];
  idsIn(direct.json, "", ids);
  console.log(`   Its id fields: ${ids.slice(0, 12).map((i) => `${i.path || "(top)"}=${short(i.value)}`).join(", ") || "none"}`);
}
console.log("\nDone. Copy everything above into the chat. Nothing private is printed.");
