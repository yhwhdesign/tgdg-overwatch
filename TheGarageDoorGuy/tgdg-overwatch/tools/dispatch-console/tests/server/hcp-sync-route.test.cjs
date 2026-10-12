const esbuild = require("esbuild");
const path = require("path");
const TMP = path.join(__dirname, "..", ".tmp");
require("fs").mkdirSync(TMP, { recursive: true });

const SRC = path.join(__dirname, "../../src");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };

(async () => {
  // Bundle the REAL route; swap only the database and the HCP client for in-memory fakes.
  const fakePrisma = path.join(TMP, "fake-prisma-sync.cjs");
  const fakeHcp = path.join(TMP, "fake-hcp-client.cjs");
  require("fs").writeFileSync(fakePrisma, `
    const match = (row, where) => Object.entries(where).every(([k, c]) => { const v = row[k];
      if (c && typeof c === "object" && !(c instanceof Date)) { if ("startsWith" in c) return typeof v === "string" && v.startsWith(c.startsWith); if ("notIn" in c) return !c.notIn.includes(v); if ("lt" in c) return v < c.lt; if ("gte" in c || "lte" in c) return (!("gte" in c) || v >= c.gte) && (!("lte" in c) || v <= c.lte); }
      return v === c; });
    const D = () => globalThis.__DB;
    module.exports.prisma = {
      technician: {
        async findMany(a) { return D().techs.filter((r) => match(r, (a && a.where) || {})).map((r) => ({ ...r })); },
        async upsert(a) { const ex = D().techs.find((r) => r.hcpEmployeeId === a.where.hcpEmployeeId); if (ex) Object.assign(ex, a.update); else D().techs.push({ id: "t" + (D().techs.length + 1), classification: null, ...a.create }); },
        async updateMany() { return { count: 0 }; },
      },
      appointment: {
        async upsert(a) { const k = a.where.hcpJobId_technicianId; const ex = D().appts.find((r) => r.hcpJobId === k.hcpJobId && r.technicianId === k.technicianId); if (ex) Object.assign(ex, a.update); else D().appts.push({ ...a.create }); },
        async deleteMany(a) { const b = D().appts.length; D().appts = D().appts.filter((r) => !match(r, a.where)); return { count: b - D().appts.length }; },
        async count(a) { return D().appts.filter((r) => match(r, a.where)).length; },
      },
      webhookEvent: {},
    };`);
  require("fs").writeFileSync(fakeHcp, `
    module.exports.hcpApi = {
      async listEmployees() { return globalThis.__HCP.employees; },
      async *listJobsInWindow() { yield { jobs: globalThis.__HCP.jobs, page: 1, totalPages: 1, totalItems: globalThis.__HCP.jobs.length }; },
      async getJob() { return null; },
      async listAppointments() { return []; },
      async listEvents() { if (globalThis.__HCP.eventsError) throw new Error(globalThis.__HCP.eventsError); return globalThis.__HCP.events; },
    };`);
  const built = await esbuild.build({
    entryPoints: [`${SRC}/app/api/admin/hcp-sync/route.ts`], bundle: true, write: false, format: "cjs", platform: "node",
    alias: { "@": SRC }, external: ["next/server"], logLevel: "silent",
    plugins: [{ name: "fakes", setup(b) { b.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({ path: fakePrisma })); b.onResolve({ filter: /^@\/lib\/hcp-client$/ }, () => ({ path: fakeHcp })); } }],
  });
  const NEXT = path.join(__dirname, "../../node_modules/next/server.js");
  const mod = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(mod, mod.exports, (id) => require(id === "next/server" ? NEXT : id));
  const { NextRequest } = require(NEXT);
  process.env.ADMIN_SYNC_SECRET = "s3cret";
  const post = async (qs, secret = "s3cret") => { const r = await mod.exports.POST(new NextRequest(`http://localhost:3000/api/admin/hcp-sync?${qs}`, { method: "POST", headers: { "x-admin-secret": secret } })); return { status: r.status, body: await r.json() }; };

  const DRAY = "pro_" + "d".repeat(32);
  const tomorrow = (h) => { const d = new Date(Date.now() + 86400000); d.setUTCHours(h + 5, 0, 0, 0); return d.toISOString(); };
  const reset = () => {
    globalThis.__DB = { techs: [], appts: [] };
    globalThis.__HCP = {
      employees: [{ id: DRAY, first_name: "Drayton", last_name: "Wilson", role: "field tech" }],
      jobs: [{ id: "job_" + "1".repeat(32), work_status: "scheduled", schedule: { scheduled_start: tomorrow(9), scheduled_end: tomorrow(11) }, assigned_employees: [{ id: DRAY }], address: { zip: "72201" } }],
      events: [{ id: "evt_1", name: "Pick up product", start_time: tomorrow(7), end_time: tomorrow(8), assigned_employees: [{ id: DRAY }] }],
      eventsError: null,
    };
  };

  reset();
  let r = await post("dryRun=1");
  check("dry run: reports jobs AND events, writes nothing", r.status === 200 && r.body.jobs.appointmentRows === 1 && r.body.events.rows === 1 && globalThis.__DB.appts.length === 0, JSON.stringify(r.body.events));
  r = await post("dryRun=0");
  const kinds = globalThis.__DB.appts.map((a) => a.kind).sort();
  check("write: a job row and an event row are both stored, kinds kept apart", JSON.stringify(kinds) === JSON.stringify(["event", "job"]), JSON.stringify(kinds));
  check("write: the event keeps its title", globalThis.__DB.appts.find((a) => a.kind === "event").label === "Pick up product");

  // THE PROMISE: an events failure never undoes the job sync
  reset(); globalThis.__HCP.eventsError = "HCP would not list events: HTTP 500 boom";
  r = await post("dryRun=0");
  check("events FAIL: the request still succeeds", r.status === 200, String(r.status));
  check("events FAIL: the job sync completed and was written", r.body.jobs.appointmentRows === 1 && globalThis.__DB.appts.filter((a) => a.kind === "job").length === 1);
  check("events FAIL: the report carries the reason instead of crashing", r.body.events && /HCP would not list events/.test(r.body.events.error), JSON.stringify(r.body.events));

  // an unreadable event shape is reported by name, jobs unaffected
  reset(); globalThis.__HCP.events = [{ id: "evt_weird", name: "Secret customer thing", foo: "bar", employee_ids: [DRAY] }];
  r = await post("dryRun=0");
  check("unreadable events: reported with field names only, jobs fine", r.status === 200 && r.body.events.unreadable.length === 1 && r.body.events.unreadable[0].fields.includes("foo") && !JSON.stringify(r.body).includes("Secret customer") && globalThis.__DB.appts.length === 1, JSON.stringify(r.body.events));

  check("wrong secret still refused", (await post("dryRun=1", "nope")).status === 403);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
