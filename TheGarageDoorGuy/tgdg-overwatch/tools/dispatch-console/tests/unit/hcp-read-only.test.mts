// @ts-nocheck
import http from "node:http";
import { syncEmployees, syncJobsWindow, syncSingleJob, type Db } from "../../src/lib/hcp-sync.ts";

const methods: string[] = []; const paths: string[] = [];
const server = http.createServer((req, res) => {
  methods.push(req.method ?? "?"); paths.push((req.url ?? "").split("?")[0]);
  res.writeHead(200, { "content-type": "application/json" });
  const u = new URL(req.url!, "http://x");
  if (u.pathname === "/employees") return res.end(JSON.stringify({ page: 1, total_pages: 1, total_items: 1, employees: [{ id: "pro_" + "a".repeat(32), first_name: "Test", last_name: "Tech", role: "field tech" }] }));
  if (u.pathname === "/jobs") return res.end(JSON.stringify({ page: 1, total_pages: 1, total_items: 1, jobs: [{ id: "job_" + "b".repeat(32), work_status: "scheduled", schedule: { scheduled_start: "2026-10-06T14:00:00Z", scheduled_end: "2026-10-06T16:00:00Z" }, assigned_employees: [{ id: "pro_" + "a".repeat(32) }], address: { zip: "72201" } }] }));
  if (u.pathname.startsWith("/jobs/")) return res.end(JSON.stringify({ id: "job_" + "b".repeat(32), work_status: "scheduled", schedule: { scheduled_start: "2026-10-06T14:00:00Z", scheduled_end: "2026-10-06T16:00:00Z" }, assigned_employees: [{ id: "pro_" + "a".repeat(32) }] }));
  res.end("{}");
});
await new Promise<void>((r) => server.listen(0, r));
process.env.HCP_BASE_URL = `http://localhost:${(server.address() as any).port}`; process.env.HCP_API_KEY = "k";
const { hcpApi } = await import("../../src/lib/hcp-client.ts");

// a database that accepts writes (this is OUR database, not HCP)
const techs: any[] = [];
const db: Db = {
  technician: { async findMany() { return techs; }, async upsert(a: any) { if (!techs.find((t) => t.hcpEmployeeId === a.where.hcpEmployeeId)) techs.push({ id: "t1", name: a.create.name, active: true, hcpEmployeeId: a.create.hcpEmployeeId }); }, async updateMany() { return { count: 0 }; } },
  appointment: { async upsert() {}, async deleteMany() { return { count: 0 }; }, async count() { return 0; } },
  zipCoverage: { async upsert() {} }, webhookEvent: { async findUnique() { return null; }, async upsert() {}, async update() {} },
};
const deps = { db, hcp: hcpApi };
const { employees } = await syncEmployees(deps, { dryRun: false });                       // --write path
await syncJobsWindow(deps, { from: new Date("2026-10-04"), to: new Date("2026-10-26"), dryRun: false, employees });
await syncSingleJob(deps, "job_" + "b".repeat(32));                                       // the webhook path
server.close();
const counts = methods.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
console.log("Requests Housecall Pro received during a full --write sync + a webhook-style refresh:");
console.log("  by method:", JSON.stringify(counts));
console.log("  paths    :", [...new Set(paths)].join(", "));
const allReads = methods.length > 0 && methods.every((m) => m === "GET");
console.log(allReads ? "RESULT: every single request was a read-only GET" : "RESULT: !!! NON-GET REQUEST DETECTED");
process.exit(allReads ? 0 : 1);   // a guarantee that cannot fail is not a guarantee
