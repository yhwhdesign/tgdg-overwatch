// "Why isn't this person's booked time showing?" Read-only. Run from tools/dispatch-console
// with `npm run dev` running:
//
//   node scripts/hcp-diagnose.mjs "Drayton Wilson"              checks TOMORROW
//   node scripts/hcp-diagnose.mjs "Drayton Wilson" 2026-10-07   checks that day
//
// It asks Housecall Pro what is really scheduled for that person that day, then checks whether
// our sync would record it and whether our database actually has it, and tells you in plain
// English where it gets lost. Prints staff names, job-id endings, statuses, job type labels and
// times only. No customer details. Nothing is written to HCP or to your database.

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

// Must match DIAGNOSE_VERSION in src/lib/hcp-diagnose.ts.
const EXPECTED_VERSION = 3;

const [name, date] = process.argv.slice(2);
if (!name) {
  console.error('Usage: node scripts/hcp-diagnose.mjs "Drayton Wilson" [YYYY-MM-DD]');
  process.exit(1);
}
const secret = process.env.ADMIN_SYNC_SECRET;
if (!secret) {
  console.error("ADMIN_SYNC_SECRET is empty. Add it to .env, restart npm run dev, and try again.");
  process.exit(1);
}

const base = process.env.SYNC_BASE_URL || "http://localhost:3000";
const qs = new URLSearchParams({ name });
if (date) qs.set("date", date);

let res;
try {
  res = await fetch(`${base}/api/admin/diagnose?${qs}`, { headers: { "x-admin-secret": secret } });
} catch (err) {
  console.error(`Could not reach ${base}. Is npm run dev running? (${err.message})`);
  process.exit(1);
}
const r = await res.json().catch(() => ({}));

// A dev server that is still running OLD code is the most common reason this report misbehaves.
const staleHelp = [
  "",
  `The server answered with diagnose code version ${r.version ?? "(none: very old)"}, but this script expects version ${EXPECTED_VERSION}.`,
  "Your running `npm run dev` is still on OLD files. To fix it:",
  "  1. In the tab running npm run dev, press Ctrl+C to stop it.",
  "  2. Make sure you unzipped the latest diagnose.zip into the repo.",
  "  3. Run: rm -rf .next",
  "  4. Run: npm run dev",
  "  5. Run this command again.",
].join("\n");
const looksOld = r.version !== EXPECTED_VERSION;

if (!res.ok || r.ok === false) {
  console.error(r.error ?? `HTTP ${res.status}`);
  if (looksOld || /Archived job/i.test(r.error ?? "")) {
    if (/Archived job/i.test(r.error ?? "")) {
      console.error("\nThat error comes from the OLD version of this report, which stopped on archived jobs. The new version never does.");
    }
    console.error(staleHelp);
  }
  process.exit(1);
}
if (looksOld) console.error(staleHelp + "\n");

const line = (s = "") => console.log(s);
line();
line(`=== ${r.person.name} on ${r.date}   (times in ${r.timeZone})`);
line(`Our sync asks HCP for jobs that START between ${r.syncWindow.from} and ${r.syncWindow.to}.`);
line(`Checked ${r.scanned.jobs} jobs from the last ${r.scanned.lookbackDays} days (${r.scanned.appointmentLookups} appointment lookups; ${r.scanned.archivedJobs} archived job${r.scanned.archivedJobs === 1 ? "" : "s" } skipped, ${r.scanned.lookupErrors} could not be read).`);
line();
line(`WHAT HOUSECALL PRO SAYS (${r.items.length} job${r.items.length === 1 ? "" : "s"} touching ${r.person.name} that day)`);
if (r.items.length === 0) line("  nothing found");
r.items.forEach((it, i) => {
  line(`  ${i + 1}. job ...${it.job}${it.archived ? "   [ARCHIVED]" : ""}   status: ${it.status ?? "?"}   type: ${it.jobType ?? "(none set)"}`);
  if (Object.keys(it.archiveFields).length) line(`     fields on the job list entry that mention archiving: ${JSON.stringify(it.archiveFields)}`);
  line(`     job-level schedule: ${it.jobSchedule ? `${it.jobSchedule.start} to ${it.jobSchedule.end}` : "none"}`);
  line(`     assigned: ${it.assignedNames.join(", ") || "nobody"}`);
  line(`     appointments (${it.appointments.length}${it.embeddedAppointments ? `, ${it.embeddedAppointments} embedded in the job` : ""}):`);
  for (const a of it.appointments) {
    line(`       - ${a.start} to ${a.end}${a.anytime ? "  [anytime]" : ""}   dispatched: ${a.dispatchedNames.join(", ") || "nobody"}${a.onThisDay ? "   <-- this day" : ""}`);
  }
  line(`     our sync: ${it.ourSyncBlocksThisDay ? "RECORDS it, so it should show as booked" : "does NOT record it for this day"}   |   in our database: ${it.inDatabase === null ? "n/a" : it.inDatabase ? "yes" : "NO"}`);
  for (const n of it.notes) line(`       * ${n}`);
});
line();
line(`WHAT OUR DATABASE HOLDS FOR ${r.person.name} THAT DAY (${r.database.rows.length})`);
if (r.database.rows.length === 0) line("  nothing");
for (const row of r.database.rows) line(`  - job ...${row.job}   ${row.start} to ${row.end}   ${row.status}`);
line(`  (our database was last written to: ${r.database.latestRowUpdate ?? "never"})`);
line();
line("FINDINGS");
for (const f of r.findings) line(`  * ${f}`);
line();
line("Read-only: nothing was written to HCP or to your database.");
