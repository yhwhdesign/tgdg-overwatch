// The real notification routes (admin list, test button, scheduled sender) with the database and Housecall Pro swapped
// for in-memory fakes, and the push service (ntfy) swapped for a recording fetch.
const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");
const SRC = path.join(__dirname, "../../src");
const NEXT = path.join(__dirname, "../../node_modules/next/server.js");
const TMP = path.join(__dirname, "..", ".tmp");
fs.mkdirSync(TMP, { recursive: true });
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
process.env.BUSINESS_TIMEZONE = "Etc/UTC";

(async () => {
  const fakePrisma = path.join(TMP, "fake-prisma-notify.cjs");
  fs.writeFileSync(fakePrisma, `
    const D = () => globalThis.__NDB;
    const dup = () => Object.assign(new Error("unique"), { code: "P2002" });
    const missing = () => Object.assign(new Error("missing"), { code: "P2025" });
    module.exports.prisma = {
      notifyRecipient: {
        async findMany() { return D().people.map((p) => ({ ...p })); },
        async findUnique(a) { const p = D().people.find((x) => x.id === a.where.id); return p ? { ...p } : null; },
        async create(a) { const p = { id: "p" + (D().people.length + 1), createdAt: new Date(), enabled: true, ...a.data }; D().people.push(p); return { ...p }; },
        async update(a) { const p = D().people.find((x) => x.id === a.where.id); if (!p) throw missing(); Object.assign(p, a.data); return { ...p }; },
        async deleteMany(a) { const b = D().people.length; D().people = D().people.filter((x) => x.id !== a.where.id); return { count: b - D().people.length }; },
      },
      notifySent: {
        async create(a) { if (D().sent.has(a.data.key)) throw dup(); D().sent.set(a.data.key, a.data.sentAt); return a.data; },
        async deleteMany(a) { if (a.where.key) D().sent.delete(a.where.key); if (a.where.sentAt) for (const [k, t] of [...D().sent]) if (t < a.where.sentAt.lt) D().sent.delete(k); return { count: 0 }; },
      },
    };`);
  const fakeWatch = path.join(TMP, "fake-watch-all.cjs");
  fs.writeFileSync(fakeWatch, `module.exports.getAllWatch = async () => { if (globalThis.__WATCH_ERROR) throw new Error("hcp exploded Zelda"); return globalThis.__WATCH; };`);
  const entry = path.join(TMP, "entry-notify.ts");
  fs.writeFileSync(entry, `export * as admin from "@/app/api/admin/notify/route"; export * as test from "@/app/api/admin/notify/test/route"; export * as cron from "@/app/api/cron/notify/route"; export { createSessionValue, ADMIN_COOKIE } from "@/lib/admin-session";`);
  const swap = { name: "swap", setup(b) {
    b.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({ path: fakePrisma }));
    b.onResolve({ filter: /^@\/lib\/watch-all$/ }, () => ({ path: fakeWatch }));
  } };
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", alias: { "@": SRC }, external: ["next/server", "node:crypto"], plugins: [swap], logLevel: "silent" });
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, (id) => require(id === "next/server" ? NEXT : id));
  const { admin, test, cron, createSessionValue, ADMIN_COOKIE } = mod.exports;
  const { NextRequest } = require(NEXT);

  const pushes = []; let pushStatus = 200;
  globalThis.fetch = async (url, init) => { pushes.push({ url: String(url), init }); return new Response("ok", { status: pushStatus }); };
  const reset = () => { globalThis.__NDB = { people: [], sent: new Map() }; globalThis.__WATCH_ERROR = false; pushes.length = 0; pushStatus = 200; };
  reset();

  const PW = "admin-pass";
  process.env.ADMIN_PASSWORD = PW;
  const cookie = { cookie: `${ADMIN_COOKIE}=${createSessionValue(PW)}` };
  const req = (url, method, headers = {}, body) => new NextRequest("http://localhost:3000" + url, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const call = async (fn, url, method, headers, body) => { const r = await fn(req(url, method, headers, body)); return { status: r.status, body: await r.json().catch(() => ({})) }; };

  // ---- sign-in
  let r;
  for (const [fn, m] of [[admin.GET, "GET"], [admin.POST, "POST"], [admin.PUT, "PUT"], [admin.DELETE, "DELETE"]]) { r = await call(fn, "/api/admin/notify", m, {}, m === "GET" ? undefined : { name: "x" }); check(`A1 ${m} without an admin sign-in is refused (401)`, r.status === 401, JSON.stringify(r)); }
  r = await call(test.POST, "/api/admin/notify/test", "POST", {}, { id: "p1" });
  check("A2 the test button is admin-only too", r.status === 401);
  check("A3 nothing was written or sent by the refused calls", globalThis.__NDB.people.length === 0 && pushes.length === 0);
  const savedPw = process.env.ADMIN_PASSWORD; delete process.env.ADMIN_PASSWORD;
  r = await call(admin.GET, "/api/admin/notify", "GET", cookie);
  check("A4 with admin switched off the whole list is unavailable (503)", r.status === 503);
  process.env.ADMIN_PASSWORD = savedPw;
  r = await admin.POST(new NextRequest("http://localhost:3000/api/admin/notify", { method: "POST", headers: { ...cookie, "content-type": "text/plain" }, body: "name=x" }));
  check("A5 a form-style (non-JSON) write is refused (415), which blocks cross-site forms", r.status === 415);

  // ---- the list
  r = await call(admin.GET, "/api/admin/notify", "GET", cookie);
  check("B1 empty list: no people, the four kinds, the push server, and whether the scheduler secret is set", r.status === 200 && r.body.people.length === 0 && r.body.kinds.length === 4 && r.body.server === "https://ntfy.sh" && r.body.schedulerReady === false, JSON.stringify(r.body));
  process.env.CRON_SECRET = "cron-secret";
  r = await call(admin.GET, "/api/admin/notify", "GET", cookie);
  check("B2 schedulerReady turns true once CRON_SECRET is set", r.body.schedulerReady === true);
  r = await call(admin.POST, "/api/admin/notify", "POST", cookie, { name: "  Jasen   B " });
  const person = r.body.person;
  check("B3 adding a person tidies the name, gives a private random channel, no alerts yet, switched on", r.status === 201 && person.name === "Jasen B" && /^tgdg-[a-z2-7]{24}$/.test(person.topic) && JSON.stringify(person.kinds) === "[]" && person.enabled === true, JSON.stringify(r));
  r = await call(admin.POST, "/api/admin/notify", "POST", cookie, { name: "Dispatch", kinds: ["estimate-finished", "job-over"] });
  check("B4 a new person can start with chosen alerts", r.status === 201 && JSON.stringify(r.body.person.kinds) === '["estimate-finished","job-over"]');
  check("B5 two people never share a channel", globalThis.__NDB.people[0].topic !== globalThis.__NDB.people[1].topic);
  for (const bad of [{}, { name: "" }, { name: "   " }, { name: "x".repeat(61) }, { name: 5 }, { name: "ok", kinds: ["nope"] }, { name: "ok", kinds: "job-over" }]) { r = await call(admin.POST, "/api/admin/notify", "POST", cookie, bad); check(`B6 a bad add ${JSON.stringify(bad).slice(0, 50)} is refused (400)`, r.status === 400, JSON.stringify(r)); }
  check("B7 and nothing extra was added", globalThis.__NDB.people.length === 2);
  r = await call(admin.GET, "/api/admin/notify", "GET", cookie);
  check("B8 the list shows both people with their channels", r.body.people.length === 2 && r.body.people.every((p) => /^tgdg-/.test(p.topic)));

  // ---- changes
  r = await call(admin.PUT, "/api/admin/notify", "PUT", cookie, { id: person.id, kinds: ["job-finished"], enabled: false, name: "Jasen Burkett" });
  check("C1 changing alerts, the on/off bell and the name", r.status === 200 && JSON.stringify(r.body.person.kinds) === '["job-finished"]' && r.body.person.enabled === false && r.body.person.name === "Jasen Burkett", JSON.stringify(r));
  r = await call(admin.PUT, "/api/admin/notify", "PUT", cookie, { id: person.id, enabled: true });
  check("C2 changing only one thing leaves the rest alone", r.body.person.enabled === true && JSON.stringify(r.body.person.kinds) === '["job-finished"]');
  for (const bad of [{ id: person.id, kinds: ["x"] }, { id: person.id, enabled: "yes" }, { id: person.id, name: "" }, { kinds: [] }, { id: "" }]) { r = await call(admin.PUT, "/api/admin/notify", "PUT", cookie, bad); check(`C3 a bad change ${JSON.stringify(bad)} is refused (400)`, r.status === 400, JSON.stringify(r)); }
  r = await call(admin.PUT, "/api/admin/notify", "PUT", cookie, { id: "nobody", enabled: false });
  check("C4 changing someone who does not exist is a 404", r.status === 404);
  r = await call(admin.PUT, "/api/admin/notify", "PUT", cookie, { id: person.id, topic: "tgdg-hacked-hacked-hacked-1234" });
  check("C5 the channel name cannot be changed from outside", globalThis.__NDB.people[0].topic === person.topic);

  // ---- the test button
  r = await call(test.POST, "/api/admin/notify/test", "POST", cookie, { id: person.id });
  const p0 = pushes[0];
  check("D1 the test posts to that person's channel with a title, a priority, a tap link and a plain message", r.status === 200 && r.body.ok === true && p0.url === `https://ntfy.sh/${person.topic}` && p0.init.method === "POST" && p0.init.headers.Title === "Test from TGDG Overwatch" && p0.init.headers.Click === "https://pro.housecallpro.com/" && /notifications reach this phone/.test(p0.init.body), JSON.stringify(pushes));
  pushes.length = 0; pushStatus = 500;
  r = await call(test.POST, "/api/admin/notify/test", "POST", cookie, { id: person.id });
  check("D2 a failing push service gives a plain 502 message, without the service's text", r.status === 502 && /could not be reached/.test(r.body.error) && !/500/.test(JSON.stringify(r.body)), JSON.stringify(r));
  pushStatus = 200;
  r = await call(test.POST, "/api/admin/notify/test", "POST", cookie, { id: "nobody" });
  check("D3 testing someone who does not exist is a 404 and sends nothing", r.status === 404 && pushes.length === 1 /* only the failed one above */);
  r = await call(test.POST, "/api/admin/notify/test", "POST", cookie, {});
  check("D4 no id is a 400", r.status === 400);

  // ---- removing
  r = await call(admin.DELETE, "/api/admin/notify", "DELETE", cookie, { id: globalThis.__NDB.people[1].id });
  check("E1 removing a person", r.status === 200 && r.body.removed === 1 && globalThis.__NDB.people.length === 1);
  r = await call(admin.DELETE, "/api/admin/notify", "DELETE", cookie, { id: "nobody" });
  check("E2 removing someone who is not there is harmless (removed: 0)", r.status === 200 && r.body.removed === 0);
  r = await call(admin.DELETE, "/api/admin/notify", "DELETE", cookie, {});
  check("E3 no id is a 400", r.status === 400);

  // ---- the scheduled sender
  const nowIso = new Date().toISOString();
  const minAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
  reset();
  globalThis.__NDB.people.push({ id: "p1", name: "Jasen", topic: "tgdg-" + "q".repeat(24), kinds: ["estimate-finished", "job-over"], enabled: true, createdAt: new Date(Date.now() - 86_400_000) });
  globalThis.__WATCH = { ok: true, alerts: [{ id: "job_1@120", kind: "install", label: "Install #1", techs: ["Alex Tech"], startedAt: minAgo(130), startedLabel: "7:50 AM", minutesOnJob: 130, limitMinutes: 120, url: "https://pro.housecallpro.com/app/jobs/job_1" }], completed: [{ id: "csr_1#9", kind: "estimate", label: "Estimate #8801", techs: ["Alex Tech"], completedAt: minAgo(3), completedLabel: "9:57 AM", minutesOnJob: 20, notes: ["Steel Back: $1,500"], url: "https://pro.housecallpro.com/app/estimates/csr_1" }, { id: "job_2#8", kind: "service", label: "Service #4600", techs: ["Alex Tech"], completedAt: minAgo(4), completedLabel: "9:56 AM", minutesOnJob: 65, notes: ["gate code 4471"], url: null }] };
  const ask = (headers = {}, method = "GET") => cron[method](new NextRequest("https://x.test/api/cron/notify", { method, headers }));
  delete process.env.CRON_SECRET;
  let res = await ask({ authorization: "Bearer cron-secret" });
  check("F1 with no CRON_SECRET the sender is off (503) and sends nothing", res.status === 503 && pushes.length === 0);
  process.env.CRON_SECRET = "cron-secret";
  res = await ask({}); check("F2 no token: refused (401)", res.status === 401);
  res = await ask({ authorization: "Bearer wrong" }); check("F3 wrong token: refused (401)", res.status === 401);
  res = await cron.GET(new NextRequest("https://x.test/api/cron/notify?key=cron-secret"));
  check("F4 a secret in the address does not count", res.status === 401 && pushes.length === 0);
  const hourNow = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Etc/UTC", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  process.env.AUTO_SYNC_HOURS = hourNow < 23 ? `${hourNow + 1}-24` : "0-23";
  res = await ask({ authorization: "Bearer cron-secret" });
  check("F5 outside the business hours it does nothing (so the free database can sleep)", (await res.json()).skipped === "outside the business hours" && pushes.length === 0);
  process.env.AUTO_SYNC_HOURS = "0-24";
  res = await ask({ authorization: "Bearer cron-secret" });
  let b = await res.json();
  check("F6 inside the hours it tells Jasen about the two things he chose (the finished estimate and the long install), not the job he did not", res.status === 200 && b.ok === true && b.sent === 2 && pushes.length === 2 && pushes.every((p) => p.url === `https://ntfy.sh/tgdg-${"q".repeat(24)}`), JSON.stringify([b, pushes.map((p) => p.init.headers.Title)]));
  check("F7 the messages carry the tap-to-open link and no notes", pushes.some((p) => p.init.headers.Click === "https://pro.housecallpro.com/app/estimates/csr_1") && !pushes.some((p) => /4471/.test(p.init.body)));
  pushes.length = 0;
  res = await ask({ authorization: "Bearer cron-secret" }, "POST"); b = await res.json();
  check("F8 asking again (POST works too) tells nobody twice", b.sent === 0 && b.alreadySent === 2 && pushes.length === 0, JSON.stringify(b));
  globalThis.__NDB.sent.clear(); pushStatus = 500; const quiet = console.error; console.error = () => {};
  res = await ask({ authorization: "Bearer cron-secret" }); b = await res.json();
  check("F9 when the push service is down the sends are counted as failed and NOT recorded", b.failed === 2 && b.sent === 0 && globalThis.__NDB.sent.size === 0, JSON.stringify(b));
  pushStatus = 200; pushes.length = 0;
  res = await ask({ authorization: "Bearer cron-secret" }); b = await res.json();
  console.error = quiet;
  check("F10 and the next run delivers them", b.sent === 2 && pushes.length === 2);
  globalThis.__WATCH = { ok: false, error: "x" }; pushes.length = 0;
  res = await ask({ authorization: "Bearer cron-secret" }); b = await res.json();
  check("F11 if Housecall Pro could not be read it skips quietly (200) and sends nothing", res.status === 200 && /could not read/.test(b.skipped) && pushes.length === 0);
  globalThis.__WATCH_ERROR = true; console.error = () => {};
  res = await ask({ authorization: "Bearer cron-secret" }); b = await res.json();
  console.error = quiet;
  check("F12 an unexpected crash is a plain 500 with no internal text", res.status === 500 && !/Zelda|exploded/.test(JSON.stringify(b)), JSON.stringify(b));
  check("F13 nothing sensitive ever went to the push service", !pushes.some((p) => /Zelda|Quimby|4471/.test(JSON.stringify(p))));

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
