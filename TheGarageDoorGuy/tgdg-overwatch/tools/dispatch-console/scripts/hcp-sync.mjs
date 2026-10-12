// Pulls your real technicians and upcoming jobs from Housecall Pro into the
// database, by calling the local dispatch console (so `npm run dev` must be running).
//
//   node scripts/hcp-sync.mjs                      dry run: shows what WOULD happen, writes nothing
//   node scripts/hcp-sync.mjs --write              actually write
//   node scripts/hcp-sync.mjs --write --retire-demo
//        --retire-demo  deactivate the "Jordan (Demo Tech)" seed technician
//
// Forward-looking only: it mirrors from midnight today through 30 days ahead and clears
// anything in our database that has already ended. Nothing is ever written to HCP.
//
// The report contains counts, technician names and times only: no customer data.

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

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

const secret = process.env.ADMIN_SYNC_SECRET;
if (!secret) {
  console.error('ADMIN_SYNC_SECRET is empty. Add a line like ADMIN_SYNC_SECRET="some-long-random-text" to .env, restart npm run dev, and try again.');
  process.exit(1);
}

const base = process.env.SYNC_BASE_URL || "http://localhost:3000";
const write = flag("--write");
const qs = new URLSearchParams({ dryRun: write ? "0" : "1" });
if (flag("--retire-demo")) qs.set("retireDemo", "1");

console.log(write ? "WRITE run" : "DRY run (nothing will be written; add --write to apply)");
console.error("Working. Reading every event from Housecall Pro can take a minute or two; you will see a line every few seconds.");
const startedAt = Date.now();
const heartbeat = setInterval(() => console.error(`  ...still working (${Math.round((Date.now() - startedAt) / 1000)}s)`), 8000);
let res;
let body;
try {
  res = await fetch(`${base}/api/admin/hcp-sync?${qs}`, { method: "POST", headers: { "x-admin-secret": secret } });
  body = await res.json().catch(() => ({}));
} catch (err) {
  clearInterval(heartbeat);
  console.error(`Could not reach ${base}. Is npm run dev running? (${err.message})`);
  process.exit(1);
}
clearInterval(heartbeat);
console.error(`Done in ${Math.round((Date.now() - startedAt) / 1000)}s.`);
if (!res.ok) {
  console.error(`HTTP ${res.status}:`, body.error ?? body);
  if (res.status === 404) console.error("ADMIN_SYNC_SECRET isn't set in the running server. Restart npm run dev after editing .env.");
  process.exit(1);
}
console.log(JSON.stringify(body, null, 2));
