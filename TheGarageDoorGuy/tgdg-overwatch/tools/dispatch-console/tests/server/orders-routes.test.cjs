// The real order-tracker routes with the database swapped for an in-memory fake.
const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");
const SRC = path.join(__dirname, "../../src");
const NEXT = path.join(__dirname, "../../node_modules/next/server.js");
const TMP = path.join(__dirname, "..", ".tmp");
fs.mkdirSync(TMP, { recursive: true });
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
process.env.BUSINESS_TIMEZONE = "America/Chicago";
process.env.ADMIN_PASSWORD = "pw-for-tests";

(async () => {
  const fakePrisma = path.join(TMP, "fake-prisma-orders.cjs");
  fs.writeFileSync(fakePrisma, `
    const D = () => globalThis.__ODB;
    const missing = () => Object.assign(new Error("missing"), { code: "P2025" });
    const dup = () => Object.assign(new Error("dup"), { code: "P2002" });
    const withVendor = (o) => ({ ...o, vendor: o.vendorId ? (() => { const v = D().vendors.find((x) => x.id === o.vendorId); return v ? { id: v.id, name: v.name, portalUrl: v.portalUrl, website: v.website } : null; })() : null });
    module.exports.prisma = {
      order: {
        async findMany() { return D().orders.map(withVendor); },
        async create(a) { const o = { id: "o" + (++D().seq), createdAt: new Date(2026, 9, D().seq).toISOString(), ...a.data }; D().orders.push(o); return withVendor(o); },
        async update(a) { const o = D().orders.find((x) => x.id === a.where.id); if (!o) throw missing(); Object.assign(o, a.data); return withVendor(o); },
        async deleteMany(a) { const b = D().orders.length; D().orders = D().orders.filter((x) => x.id !== a.where.id); return { count: b - D().orders.length }; },
      },
      vendor: {
        async findMany() { return [...D().vendors].sort((a, b) => a.name.localeCompare(b.name)); },
        async findUnique(a) { return D().vendors.find((v) => v.id === a.where.id) ?? null; },
        async create(a) { if (D().vendors.some((v) => v.name === a.data.name)) throw dup(); const v = { id: "v" + (++D().seq), ...a.data }; D().vendors.push(v); return v; },
        async update(a) { const v = D().vendors.find((x) => x.id === a.where.id); if (!v) throw missing(); if (D().vendors.some((x) => x.id !== v.id && x.name === a.data.name)) throw dup(); Object.assign(v, a.data); return v; },
        async deleteMany(a) { const b = D().vendors.length; D().vendors = D().vendors.filter((x) => x.id !== a.where.id); D().orders.forEach((o) => { if (o.vendorId === a.where.id) o.vendorId = null; }); return { count: b - D().vendors.length }; },
      },
    };`);
  const entry = path.join(TMP, "entry-orders.ts");
  fs.writeFileSync(entry, `export * as orders from "@/app/api/admin/orders/route"; export * as order from "@/app/api/admin/orders/[id]/route"; export * as vendors from "@/app/api/admin/vendors/route"; export * as vendor from "@/app/api/admin/vendors/[id]/route"; export { createSessionValue, ADMIN_COOKIE } from "@/lib/admin-session";`);
  const swap = { name: "swap", setup(b) { b.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({ path: fakePrisma })); } };
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", alias: { "@": SRC }, external: ["next/server", "node:crypto"], plugins: [swap], logLevel: "silent" });
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, (id) => require(id === "next/server" ? NEXT : id));
  const { orders, order, vendors, vendor, createSessionValue, ADMIN_COOKIE } = mod.exports;
  const { NextRequest } = require(NEXT);
  globalThis.__ODB = { orders: [], vendors: [], seq: 0 };

  const cookie = `${ADMIN_COOKIE}=${createSessionValue("pw-for-tests")}`;
  const req = (method, url, body, opts = {}) => new NextRequest(`http://localhost:3000${url}`, { method, headers: { ...(opts.noCookie ? {} : { cookie }), ...(body !== undefined || method !== "GET" ? { "content-type": opts.type ?? "application/json" } : {}) }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const call = async (handler, method, url, body, opts, params) => { const r = await handler(req(method, url, body, opts), params ? { params: Promise.resolve(params) } : undefined); return { status: r.status, body: await r.json() }; };

  // sign-in
  check("A1 not signed in: list refused", (await call(orders.GET, "GET", "/api/admin/orders", undefined, { noCookie: true })).status === 401);
  check("A2 not signed in: add refused", (await call(orders.POST, "POST", "/api/admin/orders", { items: "x" }, { noCookie: true })).status === 401);
  check("A3 not signed in: vendor add/delete refused", (await call(vendors.POST, "POST", "/api/admin/vendors", { name: "x" }, { noCookie: true })).status === 401 && (await call(vendor.DELETE, "DELETE", "/api/admin/vendors/v1", undefined, { noCookie: true }, { id: "v1" })).status === 401);
  check("A4 changes must be JSON (blocks cross-site forms)", (await call(orders.POST, "POST", "/api/admin/orders", "items=x", { type: "application/x-www-form-urlencoded" })).status === 415);

  // vendors
  let r = await call(vendors.POST, "POST", "/api/admin/vendors", { name: "Clopay Supply", portalUrl: "dealer.clopay.com/orders" });
  check("V1 add a vendor", r.status === 201 && r.body.vendor.portalUrl === "https://dealer.clopay.com/orders", JSON.stringify(r.body));
  const vid = r.body.vendor.id;
  check("V2 duplicate name refused", (await call(vendors.POST, "POST", "/api/admin/vendors", { name: "Clopay Supply" })).status === 409);
  check("V3 a password field is refused", (await call(vendors.POST, "POST", "/api/admin/vendors", { name: "DDM", password: "x" })).status === 400 && globalThis.__ODB.vendors.length === 1);
  check("V4 a javascript: link is refused", (await call(vendors.POST, "POST", "/api/admin/vendors", { name: "Bad", website: "javascript:alert(1)" })).status === 400);
  r = await call(vendor.PUT, "PUT", `/api/admin/vendors/${vid}`, { name: "Clopay Supply", website: "clopay.com", accountNumber: "A-77" }, undefined, { id: vid });
  check("V5 edit a vendor", r.status === 200 && r.body.vendor.accountNumber === "A-77" && r.body.vendor.website === "https://clopay.com/");
  check("V6 edit a missing vendor: 404", (await call(vendor.PUT, "PUT", "/api/admin/vendors/nope", { name: "Z" }, undefined, { id: "nope" })).status === 404);

  // orders
  r = await call(orders.POST, "POST", "/api/admin/orders", { items: "2x 16x7 springs", jobNumber: "#4521", vendorId: vid, status: "ordered", expectedOn: "2026-10-01", cost: "250" });
  check("O1 add an order: # stripped, cost in cents, vendor attached, ordered date filled", r.status === 201 && r.body.order.jobNumber === "4521" && r.body.order.costCents === 25000 && r.body.order.vendor.name === "Clopay Supply" && /^\d{4}-\d{2}-\d{2}$/.test(r.body.order.orderedOn), JSON.stringify(r.body));
  const oid = r.body.order.id;
  check("O2 missing items refused", (await call(orders.POST, "POST", "/api/admin/orders", { jobNumber: "1" })).status === 400);
  check("O3 a vendor that doesn't exist is refused", (await call(orders.POST, "POST", "/api/admin/orders", { items: "x", vendorId: "ghost" })).status === 400);
  await call(orders.POST, "POST", "/api/admin/orders", { items: "Rollers (stock)", kind: "stock" });
  r = await call(orders.GET, "GET", "/api/admin/orders");
  check("O4 list: late order first, summary counts it", r.status === 200 && r.body.orders[0].id === oid && r.body.summary.late === 1 && r.body.summary.needsOrdering === 1 && r.body.vendors.length === 1, JSON.stringify(r.body.summary));
  r = await call(order.PUT, "PUT", `/api/admin/orders/${oid}`, { items: "2x 16x7 springs", jobNumber: "4521", vendorId: vid, status: "arrived", expectedOn: "2026-10-01", cost: "250" }, undefined, { id: oid });
  check("O5 mark arrived: arrived date filled, no longer late", r.status === 200 && !!r.body.order.arrivedOn && (await call(orders.GET, "GET", "/api/admin/orders")).body.summary.late === 0);
  check("O6 update a missing order: 404", (await call(order.PUT, "PUT", "/api/admin/orders/nope", { items: "x" }, undefined, { id: "nope" })).status === 404);
  check("O7 bad update refused", (await call(order.PUT, "PUT", `/api/admin/orders/${oid}`, { items: "x", status: "lost" }, undefined, { id: oid })).status === 400);

  // removing a vendor keeps its orders
  check("V7 remove vendor", (await call(vendor.DELETE, "DELETE", `/api/admin/vendors/${vid}`, undefined, undefined, { id: vid })).status === 200);
  r = await call(orders.GET, "GET", "/api/admin/orders");
  check("V8 ...its orders are kept, without the vendor", r.body.orders.some((o) => o.id === oid && o.vendor === null));
  check("O8 delete order", (await call(order.DELETE, "DELETE", `/api/admin/orders/${oid}`, undefined, undefined, { id: oid })).status === 200 && (await call(order.DELETE, "DELETE", `/api/admin/orders/${oid}`, undefined, undefined, { id: oid })).status === 404);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
