// @ts-nocheck
import crypto from "node:crypto";
import http from "node:http";
import { verifyHcpSignature } from "../../src/lib/verify-webhook.ts";

let failures = 0, passes = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
const hdrs = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

// ---------------- signature verification ----------------
const SECRET = "hcp_signing_secret_for_tests_123", BODY = JSON.stringify({ event: "job.updated", job: { id: "job_" + "a".repeat(32) } }), TS = "1790000000";
const hmac = (key: string | Buffer, msg: string) => crypto.createHmac("sha256", key).update(msg).digest();
const sig = (msg: string, enc: "hex" | "base64" | "base64url") => hmac(SECRET, msg).toString(enc);

const schemes: [string, string][] = [["timestamp.body", `${TS}.${BODY}`], ["timestampbody", `${TS}${BODY}`], ["body", BODY], ["body.timestamp", `${BODY}.${TS}`], ["timestamp:body", `${TS}:${BODY}`]];
for (const [label, msg] of schemes) for (const enc of ["hex", "base64", "base64url"] as const) {
  const r = verifyHcpSignature(BODY, hdrs({ "api-signature": sig(msg, enc), "api-timestamp": TS }), SECRET);
  check(`accepts ${label}/${enc}`, r.ok && r.scheme === `${label}/${enc}`, JSON.stringify(r));
}
const good = sig(`${TS}.${BODY}`, "hex");
const V = (h: Record<string, string>, body = BODY, secret = SECRET) => verifyHcpSignature(body, hdrs(h), secret);
check("sha256= prefix", V({ "api-signature": `sha256=${good}`, "api-timestamp": TS }).ok);
check("v1= prefix", V({ "api-signature": `v1=${good}`, "api-timestamp": TS }).ok);
check("v1, prefix (standard-webhooks style)", V({ "api-signature": `v1,${sig(`${TS}.${BODY}`, "base64")}`, "api-timestamp": TS }).ok);
check("rotation: several signatures, second is valid", V({ "api-signature": `v1,AAAA v1,${sig(`${TS}.${BODY}`, "base64")}`, "api-timestamp": TS }).ok);
check("uppercase hex tolerated", V({ "api-signature": good.toUpperCase(), "api-timestamp": TS }).ok);
check("webhook-* header names also read", V({ "webhook-signature": `v1,${sig(`${TS}.${BODY}`, "base64")}`, "webhook-timestamp": TS }).ok);
const whsecKey = Buffer.from("raw-key-bytes-for-whsec-test"); const whsec = "whsec_" + whsecKey.toString("base64");
check("whsec_ base64-decoded key", V({ "api-signature": hmac(whsecKey, `${TS}.${BODY}`).toString("hex"), "api-timestamp": TS }, BODY, whsec).ok);

// attacks / mistakes that MUST fail
check("REJECT wrong secret", !V({ "api-signature": good, "api-timestamp": TS }, BODY, "different-secret").ok);
check("REJECT tampered body", !V({ "api-signature": good, "api-timestamp": TS }, BODY.replace("job.updated", "job.deleted")).ok);
check("REJECT changed timestamp", !V({ "api-signature": good, "api-timestamp": "1790000001" }).ok);
check("REJECT missing signature", !V({ "api-timestamp": TS }).ok);
check("REJECT empty signature", !V({ "api-signature": "", "api-timestamp": TS }).ok);
check("REJECT garbage signature", !V({ "api-signature": "not-a-real-signature", "api-timestamp": TS }).ok);
check("REJECT truncated signature", !V({ "api-signature": good.slice(0, 40), "api-timestamp": TS }).ok);
check("REJECT signature made with the timestamp but verified with none present", !V({ "api-signature": good }).ok);
const bad = V({ "api-signature": "zzz", "api-timestamp": TS });
check("failure detail never contains the secret or signature", !JSON.stringify(bad).includes(SECRET) && !JSON.stringify(bad).includes("zzz"), JSON.stringify(bad));

// ---------------- HCP client against a fake server ----------------
type Mode = { accept: "Token" | "Bearer"; rateLimitFirst?: boolean };
async function withServer(mode: Mode, fn: (base: string, log: { auth: string[]; urls: string[] }) => Promise<void>) {
  const log = { auth: [] as string[], urls: [] as string[] }; let limited = false;
  const server = http.createServer((req, res) => {
    const a = (req.headers.authorization ?? "").split(" ")[0]; log.auth.push(a); log.urls.push(req.url ?? "");
    const send = (code: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
    if ((req.headers.authorization ?? "") !== `${mode.accept} secret-key`) return send(401, { error: "nope" });
    if (mode.rateLimitFirst && !limited) { limited = true; return send(429, { error: "slow down" }, { "retry-after": "1" }); }
    const u = new URL(req.url!, "http://x"); const page = Number(u.searchParams.get("page") ?? "1");
    if (u.pathname === "/employees") return send(200, { page, total_pages: 2, total_items: 3, employees: page === 1 ? [{ id: "pro_1" }, { id: "pro_2" }] : [{ id: "pro_3" }] });
    if (u.pathname === "/jobs") return send(200, { page, total_pages: 3, total_items: 5, jobs: page < 3 ? [{ id: `job_p${page}a` }, { id: `job_p${page}b` }] : [{ id: "job_p3a" }] });
    if (u.pathname === "/jobs/job_missing") return send(404, { error: "not found" });
    if (u.pathname === "/jobs/job_x") return send(200, { id: "job_x" });
    send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, r)); const base = `http://localhost:${(server.address() as any).port}`;
  try { await fn(base, log); } finally { server.close(); }
}
let n = 0;
async function loadClient(base: string, extraEnv: Record<string, string> = {}) {
  process.env.HCP_BASE_URL = base; process.env.HCP_API_KEY = "secret-key"; delete process.env.HCP_AUTH_SCHEME; Object.assign(process.env, extraEnv);
  return (await import(`../../src/lib/hcp-client.ts?case=${++n}`)).hcpApi as import("../../src/lib/hcp-sync.ts").HcpApi;
}

await withServer({ accept: "Token" }, async (base, log) => {
  const api = await loadClient(base);
  const emps = await api.listEmployees();
  check("client: employees paged and combined", emps.map((e) => e.id).join() === "pro_1,pro_2,pro_3", emps.map((e) => e.id).join());
  check("client: Token accepted on first try (no wasted fallback)", log.auth.filter((a) => a !== "Token").length === 0, log.auth.join());
});
await withServer({ accept: "Bearer" }, async (base, log) => {
  const api = await loadClient(base);
  await api.listEmployees();
  check("client: falls back Token -> Bearer", log.auth[0] === "Token" && log.auth[1] === "Bearer", log.auth.join());
  const before = log.auth.length; await api.getJob("job_x");
  check("client: remembers Bearer (no more Token attempts)", log.auth.slice(before).every((a) => a === "Bearer"), log.auth.slice(before).join());
  check("client: getJob 404 -> null", (await api.getJob("job_missing")) === null);
  check("client: getJob returns the job", (await api.getJob("job_x"))?.id === "job_x");
  const from = new Date("2026-10-04T00:00:00Z"), to = new Date("2026-10-25T00:00:00Z"); const pages = []; let jobs = 0;
  for await (const p of api.listJobsInWindow(from, to, { pageSize: 2 })) { pages.push(p.page); jobs += p.jobs.length; }
  check("client: jobs paged 1..3, 5 jobs total", pages.join() === "1,2,3" && jobs === 5, `${pages.join()} / ${jobs}`);
  const jobUrl = log.urls.find((u) => u.startsWith("/jobs?"))!; const q = new URL(jobUrl, "http://x").searchParams;
  check("client: sends date window + page size", q.get("scheduled_start_min") === from.toISOString() && q.get("scheduled_start_max") === to.toISOString() && q.get("page_size") === "2", jobUrl);
});
await withServer({ accept: "Token", rateLimitFirst: true }, async (base, log) => {
  const api = await loadClient(base); const t0 = Date.now();
  const emps = await api.listEmployees();
  check("client: recovers from a 429 after waiting", emps.length === 3 && Date.now() - t0 >= 900, `${Date.now() - t0}ms`);
});
await withServer({ accept: "Token" }, async (base) => {
  process.env.HCP_API_KEY = ""; const api = await loadClient(base, { HCP_API_KEY: "" });
  let msg = ""; try { await api.listEmployees(); } catch (e) { msg = (e as Error).message; }
  check("client: missing key -> clear error", /HCP_API_KEY is not set/.test(msg), msg);
});
await withServer({ accept: "Token" }, async (base) => {
  const api = await loadClient(base, { HCP_API_KEY: "wrong-key" });
  let msg = ""; try { await api.listEmployees(); } catch (e) { msg = (e as Error).message; }
  check("client: wrong key -> clear error, key not echoed", /rejected the API key/.test(msg) && !msg.includes("wrong-key"), msg);
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
