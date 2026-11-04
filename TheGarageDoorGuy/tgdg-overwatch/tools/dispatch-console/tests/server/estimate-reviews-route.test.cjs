// The real /api/estimate-reviews route (POST save, DELETE clear) with the database swapped for a fake.
const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");
const SRC = path.join(__dirname, "../../src");
const NEXT = path.join(__dirname, "../../node_modules/next/server.js");
const TMP = path.join(__dirname, "..", ".tmp");
fs.mkdirSync(TMP, { recursive: true });
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
(async () => {
  const fakePrisma = path.join(TMP, "fake-prisma-reviews.cjs");
  fs.writeFileSync(fakePrisma, `
    const D = () => globalThis.__RDB;
    module.exports.prisma = {
      estimateReview: {
        async upsert(a) { const id = a.where.estimateId; const row = D().rows.find((r) => r.estimateId === id); if (row) { Object.assign(row, a.update); return { ...row }; } const created = { estimateId: id, ...a.create }; D().rows.push(created); return { ...created }; },
        async deleteMany(a) { const b = D().rows.length; D().rows = D().rows.filter((r) => r.estimateId !== a.where.estimateId); return { count: b - D().rows.length }; },
        async findMany() { return D().rows.map((r) => ({ ...r })); },
      },
    };`);
  const entry = path.join(TMP, "entry-reviews.ts");
  fs.writeFileSync(entry, `export * as route from "@/app/api/estimate-reviews/route";`);
  const swap = { name: "swap", setup(b) { b.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({ path: fakePrisma })); } };
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", alias: { "@": SRC }, external: ["next/server"], plugins: [swap], logLevel: "silent" });
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, (id) => require(id === "next/server" ? NEXT : id));
  const { route } = mod.exports;
  const { NextRequest } = require(NEXT);
  globalThis.__RDB = { rows: [] };

  const post = async (body, opts = {}) => { const r = await route.POST(new NextRequest("http://localhost:3000/api/estimate-reviews", { method: "POST", headers: body !== undefined ? { "content-type": opts.type ?? "application/json" } : {}, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const del = async (qs) => { const r = await route.DELETE(new NextRequest(`http://localhost:3000/api/estimate-reviews${qs}`, { method: "DELETE" })); return { status: r.status, body: await r.json() }; };

  // save
  let r = await post({ estimateId: "csr_" + "a".repeat(32), reviewedBy: "  Jasen  ", note: "  called the customer ", fingerprint: "abc123" });
  check("S1 a valid review is saved, name and note trimmed", r.status === 200 && r.body.ok === true && globalThis.__RDB.rows.length === 1 && globalThis.__RDB.rows[0].reviewedBy === "Jasen" && globalThis.__RDB.rows[0].note === "called the customer" && globalThis.__RDB.rows[0].reviewedFingerprint === "abc123", JSON.stringify(globalThis.__RDB.rows[0]));
  check("S2 reviewedAt is stamped by the server", globalThis.__RDB.rows[0].reviewedAt instanceof Date);
  r = await post({ estimateId: "csr_" + "a".repeat(32), reviewedBy: "Dana", note: "second look", fingerprint: "def456" });
  check("S3 reviewing the same estimate again replaces the old review (one per estimate)", globalThis.__RDB.rows.length === 1 && globalThis.__RDB.rows[0].reviewedBy === "Dana" && globalThis.__RDB.rows[0].reviewedFingerprint === "def456");

  // validation
  check("S4 a missing/blank name is refused", (await post({ estimateId: "csr_x", reviewedBy: "   ", fingerprint: "a" })).status === 400 && (await post({ estimateId: "csr_x", fingerprint: "a" })).status === 400);
  check("S5 a bad estimate id is refused", (await post({ estimateId: "no spaces allowed!", reviewedBy: "Jasen" })).status === 400 && (await post({ reviewedBy: "Jasen" })).status === 400);
  check("S6 non-JSON body is refused", (await post("estimateId=x", { type: "application/x-www-form-urlencoded" })).status === 400);
  r = await post({ estimateId: "csr_nofp", reviewedBy: "Jasen" });
  check("S7 a missing fingerprint stores empty (so any later change re-flags it)", r.status === 200 && globalThis.__RDB.rows.find((x) => x.estimateId === "csr_nofp").reviewedFingerprint === "");
  r = await post({ estimateId: "csr_bigid", reviewedBy: "Jasen", note: "x".repeat(900), fingerprint: "zz" });
  check("S8 an over-long note is cut, not rejected", r.status === 200 && globalThis.__RDB.rows.find((x) => x.estimateId === "csr_bigid").note.length === 500);

  // delete
  check("S9 clear a review", (await del("?id=csr_" + "a".repeat(32))).status === 200 && !globalThis.__RDB.rows.some((x) => x.estimateId === "csr_" + "a".repeat(32)));
  check("S10 clearing something that isn't there still answers ok", (await del("?id=csr_gone")).status === 200);
  check("S11 delete needs a valid id", (await del("")).status === 400 && (await del("?id=bad id")).status === 400);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
