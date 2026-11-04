// Runs every test suite for the dispatch console and prints one line per run.
//   npm test                 everything
//   npm test -- events       only suites whose name contains "events"
// Needs Node 22+ (see .nvmrc) for the TypeScript unit tests. No database, no Housecall Pro account and no network
// are used: everything runs against in-memory fakes. Some suites run in several server time zones on purpose
// (the schedule logic must give the same answer wherever the server happens to run).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || "";
const STRIP = ["--experimental-strip-types", "--no-warnings"];
const ALL = ["America/Chicago", "UTC", "Asia/Tokyo", "Pacific/Auckland"];
const THREE = ["America/Chicago", "UTC", "Asia/Tokyo"];
const TWO = ["UTC", "Asia/Tokyo"];

const suites = [
  ["unit", "availability.test.mts", THREE],
  ["unit", "schedule-gaps-and-stacking.test.mts", ALL],
  ["unit", "geocode.test.mts"],
  ["unit", "orders.test.mts", ["America/Chicago", "UTC"]],
  ["unit", "reports.test.mts", THREE],
  ["unit", "hcp-sync-jobs.test.mts"],
  ["unit", "webhook-signature-and-hcp-client.test.mts"],
  ["unit", "classification-and-admin-session.test.mts"],
  ["unit", "hcp-read-only.test.mts"],
  ["unit", "diagnose.test.mts", THREE],
  ["unit", "hcp-client-errors.test.mts"],
  ["unit", "events-sync.test.mts"],
  ["unit", "events-client.test.mts"],
  ["unit", "repeat-rules.test.mts"],
  ["unit", "job-watch.test.mts", ALL],
  ["unit", "estimates.test.mts", ALL],
  ["unit", "notify.test.mts", ALL],
  ["unit", "service-worker.test.cjs"],
  ["unit", "dock-window.test.mts"],
  ["unit", "job-watch-view.test.mts", THREE],
  ["unit", "weekend-recap.test.mts", ALL],
  ["unit", "sync-status.test.mts", TWO],
  ["unit", "auto-sync-controller.test.mts", THREE],
  ["scripts", "events-probe.test.mjs"],
  ["scripts", "events-survey.test.mjs"],
  ["scripts", "jobwatch-probe.test.mjs"],
  ["scripts", "estimates-probe.test.mjs"],
  ["scripts", "find-id.test.mjs"],
  ["ui", "console-flow.test.cjs"],
  ["ui", "orders-page.test.cjs"],
  ["ui", "admin-screen.test.cjs"],
  ["ui", "reports-page.test.cjs"],
  ["ui", "estimates-page.test.cjs"],
  ["ui", "notify-panel.test.cjs"],
  ["ui", "join-client.test.cjs"],
  ["ui", "dock-button.test.cjs"],
  ["ui", "job-watch-bars.test.cjs"],
  ["ui", "weekend-page.test.cjs"],
  ["server", "offered-technicians-route.test.cjs"],
  ["server", "orders-routes.test.cjs"],
  ["server", "reports-route.test.cjs"],
  ["server", "estimate-reviews-route.test.cjs"],
  ["server", "hcp-sync-route.test.cjs"],
  ["server", "refresh-and-status.test.cjs"],
  ["server", "admin-session-route.test.cjs"],
  ["server", "job-watch-route.test.cjs"],
  ["server", "weekend-recap-route.test.cjs"],
  ["server", "notify-routes.test.cjs"],
  ["server", "console-login-and-cron.test.cjs"],
];

let failures = 0;
let runs = 0;
for (const [folder, file, zones] of suites) {
  if (filter && !file.includes(filter)) continue;
  for (const zone of zones ?? [undefined]) {
    runs += 1;
    const flags = file.endsWith(".mts") ? STRIP : [];
    const started = Date.now();
    const r = spawnSync(process.execPath, [...flags, path.join(here, folder, file)], {
      env: { ...process.env, ...(zone ? { TZ: zone } : {}) },
      encoding: "utf8",
      timeout: 300_000,
    });
    const lines = (r.stdout || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("FINGERPRINT"));
    const summary = lines.filter((l) => /passed|PASS|RESULT/.test(l)).pop() ?? lines.pop() ?? "(no output)";
    const ok = r.status === 0;
    if (!ok) failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${file}${zone ? `  [${zone}]` : ""}  ${summary}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    if (!ok) console.log((r.stdout || "").split("\n").filter((l) => /^FAIL|CRASH/.test(l)).slice(0, 12).join("\n") + (r.stderr ? `\n${r.stderr.split("\n").slice(-6).join("\n")}` : ""));
  }
}
if (runs === 0) console.log(`No suite name contains "${filter}".`);
console.log(`\n${runs - failures} of ${runs} runs passed${failures ? `, ${failures} FAILED` : ""}`);
process.exit(failures || runs === 0 ? 1 : 0);
