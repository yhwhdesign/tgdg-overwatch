// Read-only: what does Housecall Pro tell us about jobs IN PROGRESS, and how are installs labeled in YOUR account?
// Job Watch alerts when a tech has been on a job longer than normal (install 90 minutes, other work 60). Before
// trusting it, this answers the questions only your real data can:
//
//   node scripts/hcp-jobwatch-probe.mjs          (looks back 14 days)
//   node scripts/hcp-jobwatch-probe.mjs 30       (looks back 30 days; 1 to 60)
//   node scripts/hcp-jobwatch-probe.mjs --notes  (also prints the latest note from up to 3 finished jobs)
//
// GET requests only; nothing is written anywhere. It prints:
//   1. whether your techs actually tap Start and Finish in the Housecall Pro app (no taps = no data = no alerts)
//   2. the SHAPE of a job (field names), so we read it properly
//   3. how installs are labeled (job type, tags, business unit, description) and how many jobs count as installs
//   4. how long finished jobs really took, and how many would have set off the 90 / 60 minute alerts
//   5. whether finished jobs carry the tech's NOTES (Job Watch shows them when a tech finishes a job)
//   6. who is on a job right now, and what the running console says about it
// Customer names, addresses, phone numbers, emails and descriptions are never printed, and neither are notes unless
// you add --notes (a note can contain a gate code or a name). Staff names, your own job type / tag labels, and
// times are. Skim the output before pasting it anywhere.

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
const CONSOLE = (process.env.CONSOLE_URL || "http://localhost:3000").replace(/\/+$/, "");
const INSTALL_MIN = Number(process.env.JOB_WATCH_INSTALL_MINUTES) >= 5 ? Number(process.env.JOB_WATCH_INSTALL_MINUTES) : 90;
const SERVICE_MIN = Number(process.env.JOB_WATCH_SERVICE_MINUTES) >= 5 ? Number(process.env.JOB_WATCH_SERVICE_MINUTES) : 60;
const WORDS = (process.env.JOB_WATCH_INSTALL_WORDS || "install").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);

const args = process.argv.slice(2);
const showNotes = args.includes("--notes");
const daysArg = args.find((a) => !a.startsWith("--"));
const days = daysArg === undefined ? 14 : Number(daysArg);
if (!Number.isInteger(days) || days < 1 || days > 60 || args.some((a) => a.startsWith("--") && a !== "--notes")) {
  console.error("Usage: node scripts/hcp-jobwatch-probe.mjs [days back, 1 to 60] [--notes]");
  process.exit(1);
}
if (!KEY) {
  console.error("HCP_API_KEY is empty. Add it to tools/dispatch-console/.env and run again.");
  process.exit(1);
}

// ---- small helpers ----------------------------------------------------------------------------------
const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const clock = (d) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d).replace(/\u202f/g, " ");
const parse = (v) => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dur = (m) => {
  const r = Math.round(m);
  if (r < 60) return `${r}m`;
  return r % 60 === 0 ? `${r / 60}h` : `${Math.floor(r / 60)}h ${r % 60}m`;
};
const pct = (n, of) => (of === 0 ? "-" : `${Math.round((n / of) * 100)}%`);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const nearestRank = (xs, p) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(p * xs.length) - 1)];
const firstArray = (json) => {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") for (const v of Object.values(json)) if (Array.isArray(v)) return v;
  return [];
};
const TEXT_KEYS = ["name", "title", "label", "value", "text", "description"];
function textsOf(value, out = [], depth = 0) {
  if (out.length >= 40 || depth > 3 || value == null) return out;
  if (typeof value === "string") {
    if (value.trim()) out.push(value.trim());
  } else if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) textsOf(item, out, depth + 1);
  } else if (typeof value === "object") {
    for (const k of TEXT_KEYS) if (typeof value[k] === "string") textsOf(value[k], out, depth + 1);
  }
  return out;
}
function shapeOf(value) {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "string") return "text";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "true/false";
  if (Array.isArray(value)) return value.length === 0 ? "empty list" : `list of ${shapeOf(value[0])}`;
  return `object (${Object.keys(value).slice(0, 8).join(", ")})`;
}
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const top = (map, n = 15) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const clip = (s, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

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

// ---- 1. connection ----------------------------------------------------------------------------------
console.log("Housecall Pro Job Watch probe (read-only)\n");
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
console.log(`1. Connection\n   Authorization style that works: ${scheme}\n`);
const nameById = new Map(firstArray(empRes.json).map((e) => [e.id, [e.first_name, e.last_name].filter(Boolean).join(" ") || e.id]));

// ---- read the jobs ----------------------------------------------------------------------------------
const now = new Date();
const from = new Date(now.getTime() - days * 86_400_000);
const to = new Date(now.getTime() + 86_400_000);
const jobs = [];
for (let page = 1; page <= 15; page++) {
  const qs = new URLSearchParams({ page: String(page), page_size: "100", scheduled_start_min: from.toISOString(), scheduled_start_max: to.toISOString() });
  const r = await get(`/jobs?${qs}`, scheme);
  if (r.status < 200 || r.status >= 300) {
    console.error(`HCP answered HTTP ${r.status} for the job list.`);
    process.exit(1);
  }
  jobs.push(...firstArray(r.json));
  if (page >= (r.json?.total_pages ?? 1)) break;
}
const canceled = (j) => Boolean(j.canceled_at) || Boolean(j.deleted_at) || String(j.work_status ?? "").toLowerCase().includes("cancel");
const live = jobs.filter((j) => !canceled(j));
const statusOf = (j) => String(j.work_status ?? "(none)").toLowerCase();
const byStatus = new Map();
for (const j of jobs) bump(byStatus, statusOf(j));
console.log(`2. Jobs read: ${jobs.length} scheduled between ${dayKey(from)} and ${dayKey(to)} (business time ${TZ}); ${jobs.length - live.length} canceled/deleted are left out below`);
console.log(`   by status: ${top(byStatus, 12).map(([s, n]) => `${s} ${n}`).join(", ") || "(none)"}\n`);

if (live.length === 0) {
  console.log("   No jobs in that period, so there is nothing more to report. Try a longer look-back (for example 30).");
  process.exit(0);
}

// ---- 3. do techs tap Start and Finish? ----------------------------------------------------------------
const stamps = (j) => ({ started: parse(j.work_timestamps?.started_at), done: parse(j.work_timestamps?.completed_at), onWay: parse(j.work_timestamps?.on_my_way_at) });
const finished = live.filter((j) => statusOf(j).includes("complete") || stamps(j).done);
const inProgress = live.filter((j) => statusOf(j).includes("progress"));
const withStart = finished.filter((j) => stamps(j).started);
const withDone = finished.filter((j) => stamps(j).done);
console.log("3. Do your techs tap Start and Finish in the Housecall Pro app?");
console.log(`   Finished jobs: ${finished.length}  |  with a Start tap: ${withStart.length} (${pct(withStart.length, finished.length)})  |  with a Finish tap: ${withDone.length} (${pct(withDone.length, finished.length)})`);
console.log(`   Marked in progress right now: ${inProgress.length}  |  of those with a Start tap: ${inProgress.filter((j) => stamps(j).started).length}`);
console.log("   (Job Watch can only judge jobs that have a Start tap. The lower these percentages, the less it can see.)\n");

// ---- 4. the shape of a job ----------------------------------------------------------------------------
const sample = live.find((j) => stamps(j).started) ?? live[0];
console.log("4. What a job looks like (field names only)");
console.log(`   fields on a job: ${Object.keys(sample).join(", ")}`);
console.log(`   job_fields: ${sample.job_fields && typeof sample.job_fields === "object" ? Object.keys(sample.job_fields).map((k) => `${k} (${shapeOf(sample.job_fields[k])})`).join("; ") : shapeOf(sample.job_fields)}`);
console.log(`   work_timestamps: ${sample.work_timestamps && typeof sample.work_timestamps === "object" ? Object.keys(sample.work_timestamps).join(", ") : shapeOf(sample.work_timestamps)}`);
console.log(`   tags: ${shapeOf(sample.tags)}`);
const presence = ["invoice_number", "description", "name", "line_items", "tags"].map((k) => `${k} ${live.filter((j) => j[k] != null && j[k] !== "" && !(Array.isArray(j[k]) && j[k].length === 0)).length}`);
console.log(`   present on how many of the ${live.length} jobs: ${presence.join(", ")}\n`);

// ---- 5. how installs are labeled ------------------------------------------------------------------------
const sources = {
  "job type": (j) => textsOf(j.job_fields?.job_type),
  "business unit": (j) => textsOf(j.job_fields?.business_unit),
  tags: (j) => textsOf(j.tags),
  name: (j) => textsOf(j.name),
  description: (j) => textsOf(j.description),
  "line items": (j) => textsOf(j.line_items),
};
const hasWord = (texts) => WORDS.some((w) => texts.join(" \n ").toLowerCase().includes(w));
const typeValues = new Map();
const unitValues = new Map();
const tagValues = new Map();
for (const j of live) {
  for (const t of new Set(sources["job type"](j))) bump(typeValues, t);
  for (const t of new Set(sources["business unit"](j))) bump(unitValues, t);
  for (const t of new Set(sources.tags(j))) bump(tagValues, t);
}
const list = (m) => (m.size === 0 ? "(none found)" : top(m).map(([v, n]) => `"${clip(v)}" ${n}`).join(", "));
console.log(`5. How are installs labeled?  (words that mean install: ${WORDS.map((w) => `"${w}"`).join(", ")})`);
console.log(`   job type values:      ${list(typeValues)}`);
console.log(`   business unit values: ${list(unitValues)}`);
console.log(`   tag values:           ${list(tagValues)}`);
console.log(`   jobs where a source contains an install word: ${Object.entries(sources).map(([label, fn]) => `${label} ${live.filter((j) => hasWord(fn(j))).length}`).join(", ")}`);
const isInstall = (j) => hasWord(Object.values(sources).flatMap((fn) => fn(j)));
const installs = live.filter(isInstall);
console.log(`   => with those words, ${installs.length} of ${live.length} jobs count as INSTALLS and ${live.length - installs.length} as service.\n`);

// ---- 6. how long did finished jobs really take? ------------------------------------------------------------
console.log(`6. How long did finished jobs take (Start tap to Finish tap)? Limits now: install ${INSTALL_MIN} min, other work ${SERVICE_MIN} min`);
for (const [label, group, limit] of [["installs", installs, INSTALL_MIN], ["service ", live.filter((j) => !isInstall(j)), SERVICE_MIN]]) {
  const mins = group
    .map((j) => stamps(j))
    .filter((s) => s.started && s.done)
    .map((s) => (s.done.getTime() - s.started.getTime()) / 60_000)
    .filter((m) => m >= 1 && m <= 24 * 60);
  if (mins.length === 0) {
    console.log(`   ${label}: no finished jobs with both taps`);
    continue;
  }
  const over = mins.filter((m) => m > limit).length;
  console.log(`   ${label} (n=${mins.length}): typical ${dur(median(mins))}, 90th percentile ${dur(nearestRank(mins, 0.9))}, longest ${dur(Math.max(...mins))}; ${over} of ${mins.length} (${pct(over, mins.length)}) ran longer than ${limit} min`);
}
console.log("   (If most jobs would have alerted, the limit is too tight. If almost none would, it may be too loose.)\n");

// ---- 7. do finished jobs carry the tech's notes? ---------------------------------------------------------------------
const NOTE_KEYS = ["content", "text", "note", "body", "message", "description"];
function noteStrings(value) {
  const out = [];
  const take = (item) => {
    if (typeof item === "string") out.push(item);
    else if (item && typeof item === "object") for (const k of NOTE_KEYS) if (typeof item[k] === "string" && item[k].trim()) { out.push(item[k]); return; }
  };
  if (Array.isArray(value)) value.slice(-50).forEach(take);
  else take(value);
  return out.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
}
console.log("7. Do finished jobs carry the tech's notes?  (Job Watch shows them when a tech finishes a job)");
const noteLike = new Map();
for (const j of finished) for (const [k, v] of Object.entries(j)) if (/note|comment|memo|summary|remark/i.test(k)) {
  const entry = noteLike.get(k) ?? { shape: shapeOf(v), filled: 0 };
  if (v != null && v !== "" && !(Array.isArray(v) && v.length === 0)) entry.filled++;
  noteLike.set(k, entry);
}
if (noteLike.size === 0) console.log("   No field on a finished job has 'note', 'comment', 'memo', 'summary' or 'remark' in its name. Send me the 'fields on a job' list above.");
else for (const [k, e] of noteLike) console.log(`   field "${k}" (${e.shape}) is filled in on ${e.filled} of ${finished.length} finished jobs`);
const withNotes = finished.map((j) => ({ j, notes: noteStrings(j.notes) })).filter((x) => x.notes.length > 0);
const lengths = withNotes.map((x) => x.notes.join(" ").length);
console.log(`   Finished jobs with at least one readable note in the "notes" field: ${withNotes.length} of ${finished.length} (${pct(withNotes.length, finished.length)})${lengths.length ? `; typical length ${Math.round(median(lengths))} characters, longest ${Math.max(...lengths)}` : ""}`);
const missing = finished.filter((j) => j.notes === undefined).length;
if (missing > 0) console.log(`   The "notes" field is missing entirely from ${missing} finished job(s) in the job LIST; the console then reads each such job's full record once to look for notes.`);
if (showNotes) {
  const latest = withNotes.sort((a, b) => (stamps(b.j).done?.getTime() ?? 0) - (stamps(a.j).done?.getTime() ?? 0)).slice(0, 3);
  if (latest.length === 0) console.log("   (No finished job has a note to show.)");
  for (const { j, notes } of latest) console.log(`   latest note, job finished ${stamps(j).done ? clock(stamps(j).done) : "(no time)"}: "${clip(notes[notes.length - 1], 300)}"`);
  console.log("   (These notes can contain customer details. Do not paste them anywhere public.)");
} else {
  console.log("   (Add --notes to print the latest note from up to 3 finished jobs. Notes can contain customer details, so they are not printed by default.)");
}
console.log("");

// ---- 8. right now ------------------------------------------------------------------------------------------
const today = dayKey(now);
console.log("8. Right now");
let onJob = 0;
let earlier = 0;
let noTap = 0;
for (const j of live) {
  const s = stamps(j);
  if (s.done || statusOf(j).includes("complete")) continue;
  if (!s.started) {
    if (statusOf(j).includes("progress")) noTap++;
    continue;
  }
  if (dayKey(s.started) !== today) {
    earlier++;
    continue;
  }
  onJob++;
  const minutes = Math.max(0, Math.floor((now.getTime() - s.started.getTime()) / 60_000));
  const install = isInstall(j);
  const limit = install ? INSTALL_MIN : SERVICE_MIN;
  const who = (j.assigned_employees ?? []).map((e) => nameById.get(e.id) ?? "an unknown employee").join(" and ") || "nobody assigned";
  console.log(`   ${who} - ${install ? "install" : "service"} - started ${clock(s.started)} - ${dur(minutes)}${minutes >= limit ? ` (OVER the ${limit}-minute limit)` : ""}`);
}
if (onJob === 0) console.log("   Nobody is on a job (started today and not finished).");
console.log(`   Marked in progress but no Start tap (cannot be checked): ${noTap}`);
console.log(`   On a job that started on an EARLIER day (such as a multi-day install; not judged): ${earlier}`);

// ---- what the running console says ------------------------------------------------------------------------------
try {
  const res = await fetch(`${CONSOLE}/api/job-watch`, { signal: AbortSignal.timeout(4000) });
  const body = await res.json();
  if (body.ok) {
    console.log(`\n   The running console (${CONSOLE}) reports: watching ${body.watching}, ${body.alerts.length} alert(s), ${body.cantTell} it cannot check, ${body.ignoredOlder} from earlier days.`);
    for (const a of body.alerts) console.log(`     ALERT: ${a.techs.join(" and ")} on "${a.label}" for ${dur(a.minutesOnJob)} (limit ${dur(a.limitMinutes)})`);
    if (Array.isArray(body.completed)) console.log(`     ${body.completed.length} finished job(s) in the last ${body.rules?.completedHours ?? 3} hours (${body.completed.filter((c) => Array.isArray(c.notes) && c.notes.length > 0).length} with notes)`);
  } else {
    console.log(`\n   The running console (${CONSOLE}) answered, but says: ${body.error}`);
  }
} catch {
  console.log(`\n   (The console is not running at ${CONSOLE}, so its own Job Watch answer was skipped. Start it with npm run dev to compare.)`);
}
