// The real notification routes (admin list, test button, scheduled sender) with the database and Housecall Pro swapped
// for in-memory fakes, and the web-push library swapped for a recorder. Also the public routes a phone uses to connect.
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
    const withCount = (p) => ({ ...p, _count: { subscriptions: D().subs.filter((s) => s.recipientId === p.id).length } });
    module.exports.prisma = {
      notifyRecipient: {
        async findMany(a) { return D().people.map((p) => (a && a.include ? withCount(p) : { ...p })); },
        async findUnique(a) { const p = D().people.find((x) => (a.where.id ? x.id === a.where.id : x.topic === a.where.topic)); return p ? { ...p } : null; },
        async create(a) { const p = { id: "p" + (D().people.length + 1), createdAt: new Date(), enabled: true, ...a.data }; D().people.push(p); return { ...p }; },
        async update(a) { const p = D().people.find((x) => x.id === a.where.id); if (!p) throw missing(); Object.assign(p, a.data); return { ...p }; },
        async deleteMany(a) { const b = D().people.length; D().people = D().people.filter((x) => x.id !== a.where.id); D().subs = D().subs.filter((s) => D().people.some((p) => p.id === s.recipientId)); return { count: b - D().people.length }; },
      },
      pushSubscription: {
        async findMany(a) { let rows = D().subs.filter((s) => s.recipientId === a.where.recipientId); if (a.orderBy) rows = [...rows].sort((x, y) => y.createdAt - x.createdAt); return rows.map((r) => ({ ...r })); },
        async upsert(a) { const found = D().subs.find((s) => s.endpoint === a.where.endpoint); if (found) { Object.assign(found, a.update); return { ...found }; } const row = { id: "s" + (++D().seq), createdAt: D().seq, ...a.create }; D().subs.push(row); return { ...row }; },
        async deleteMany(a) { const w = a.where; const before = D().subs.length; D().subs = D().subs.filter((s) => !((w.endpoint === undefined || s.endpoint === w.endpoint) && (w.recipientId === undefined || s.recipientId === w.recipientId) && (!w.id || (w.id.in || []).includes(s.id)))); return { count: before - D().subs.length }; },
      },
      notifySent: {
        async create(a) { if (D().sent.has(a.data.key)) throw dup(); D().sent.set(a.data.key, a.data.sentAt); return a.data; },
        async deleteMany(a) { if (a.where.key) D().sent.delete(a.where.key); if (a.where.sentAt) for (const [k, t] of [...D().sent]) if (t < a.where.sentAt.lt) D().sent.delete(k); return { count: 0 }; },
      },
    };`);
  const fakeWatch = path.join(TMP, "fake-watch-all.cjs");
  fs.writeFileSync(fakeWatch, `module.exports.getAllWatch = async () => { if (globalThis.__WATCH_ERROR) throw new Error("hcp exploded Zelda"); return globalThis.__WATCH; };`);
  const entry = path.join(TMP, "entry-notify.ts");
  const fakeWebPush = path.join(TMP, "fake-web-push.cjs");
  fs.writeFileSync(fakeWebPush, `
    const sendNotification = async (sub, payload, opts) => {
      globalThis.__PUSHES.push({ sub, payload: JSON.parse(payload), opts });
      const st = (globalThis.__PUSH_STATUS && globalThis.__PUSH_STATUS(sub.endpoint)) || 201;
      if (st >= 400) throw Object.assign(new Error("push error " + st), { statusCode: st });
      return { statusCode: st };
    };
    module.exports = { default: { sendNotification }, sendNotification };`);
  fs.writeFileSync(entry, `export * as admin from "@/app/api/admin/notify/route"; export * as test from "@/app/api/admin/notify/test/route"; export * as cron from "@/app/api/cron/notify/route"; export * as pkey from "@/app/api/push/key/route"; export * as psub from "@/app/api/push/subscribe/route"; export * as punsub from "@/app/api/push/unsubscribe/route"; export * as manifest from "@/app/join/[code]/manifest.webmanifest/route"; export * as push from "@/lib/push"; export { createSessionValue, ADMIN_COOKIE } from "@/lib/admin-session";`);
  const swap = { name: "swap", setup(b) {
    b.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({ path: fakePrisma }));
    b.onResolve({ filter: /^@\/lib\/watch-all$/ }, () => ({ path: fakeWatch }));
    b.onResolve({ filter: /^web-push$/ }, () => ({ path: fakeWebPush }));
  } };
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", alias: { "@": SRC }, external: ["next/server", "node:crypto"], plugins: [swap], logLevel: "silent" });
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, (id) => require(id === "next/server" ? NEXT : id));
  const { admin, test, cron, pkey, psub, punsub, manifest, push, createSessionValue, ADMIN_COOKIE } = mod.exports;
  const { NextRequest } = require(NEXT);

  // real keys, so the key checks in push.ts are exercised for real
  const keys = require("web-push").generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey; process.env.VAPID_PRIVATE_KEY = keys.privateKey; process.env.VAPID_SUBJECT = "mailto:office@example.com";
  const pushes = []; globalThis.__PUSHES = pushes; let pushStatus = 201; globalThis.__PUSH_STATUS = () => pushStatus;
  const reset = () => { globalThis.__NDB = { people: [], sent: new Map(), subs: [], seq: 0 }; globalThis.__WATCH_ERROR = false; pushes.length = 0; pushStatus = 201; };
  reset();
  const b64 = (n) => require("crypto").randomBytes(n).toString("base64url");
  const mkSub = (n = 1) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}-${b64(12)}`, keys: { p256dh: b64(65), auth: b64(16) } });

  const PW = "admin-pass";
  process.env.ADMIN_PASSWORD = PW;
  const cookie = { cookie: `${ADMIN_COOKIE}=${createSessionValue(PW)}` };
  const req = (url, method, headers = {}, body) => new NextRequest("http://localhost:3000" + url, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const pubReq = (url, method, body, headers = {}) => new NextRequest("http://localhost:3000" + url, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const connect = async (code, sub) => { const rr = await psub.POST(pubReq("/api/push/subscribe", "POST", { code, subscription: sub })); return { status: rr.status, body: await rr.json().catch(() => ({})) }; };
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
  check("B1 empty list: no people, the four kinds, whether the alert keys are set, and whether the scheduler secret is set", r.status === 200 && r.body.people.length === 0 && r.body.kinds.length === 4 && r.body.pushReady === true && r.body.schedulerReady === false && r.body.server === undefined, JSON.stringify(r.body));
  process.env.CRON_SECRET = "cron-secret";
  r = await call(admin.GET, "/api/admin/notify", "GET", cookie);
  check("B2 schedulerReady turns true once CRON_SECRET is set", r.body.schedulerReady === true);
  r = await call(admin.POST, "/api/admin/notify", "POST", cookie, { name: "  Jasen   B " });
  const person = r.body.person;
  check("B3 adding a person tidies the name, gives a private random join code, no alerts yet, switched on, no phones yet", r.status === 201 && person.name === "Jasen B" && /^tgdg-[a-z2-7]{24}$/.test(person.topic) && JSON.stringify(person.kinds) === "[]" && person.enabled === true && person.devices === 0, JSON.stringify(r));
  r = await call(admin.POST, "/api/admin/notify", "POST", cookie, { name: "Dispatch", kinds: ["estimate-finished", "job-over"] });
  check("B4 a new person can start with chosen alerts", r.status === 201 && JSON.stringify(r.body.person.kinds) === '["estimate-finished","job-over"]');
  check("B5 two people never share a join code", globalThis.__NDB.people[0].topic !== globalThis.__NDB.people[1].topic);
  for (const bad of [{}, { name: "" }, { name: "   " }, { name: "x".repeat(61) }, { name: 5 }, { name: "ok", kinds: ["nope"] }, { name: "ok", kinds: "job-over" }]) { r = await call(admin.POST, "/api/admin/notify", "POST", cookie, bad); check(`B6 a bad add ${JSON.stringify(bad).slice(0, 50)} is refused (400)`, r.status === 400, JSON.stringify(r)); }
  check("B7 and nothing extra was added", globalThis.__NDB.people.length === 2);
  r = await call(admin.GET, "/api/admin/notify", "GET", cookie);
  check("B8 the list shows both people with their join codes", r.body.people.length === 2 && r.body.people.every((p) => /^tgdg-/.test(p.topic)));

  // ---- changes
  r = await call(admin.PUT, "/api/admin/notify", "PUT", cookie, { id: person.id, kinds: ["job-finished"], enabled: false, name: "Jasen Burkett" });
  check("C1 changing alerts, the on/off bell and the name", r.status === 200 && JSON.stringify(r.body.person.kinds) === '["job-finished"]' && r.body.person.enabled === false && r.body.person.name === "Jasen Burkett", JSON.stringify(r));
  r = await call(admin.PUT, "/api/admin/notify", "PUT", cookie, { id: person.id, enabled: true });
  check("C2 changing only one thing leaves the rest alone", r.body.person.enabled === true && JSON.stringify(r.body.person.kinds) === '["job-finished"]');
  for (const bad of [{ id: person.id, kinds: ["x"] }, { id: person.id, enabled: "yes" }, { id: person.id, name: "" }, { kinds: [] }, { id: "" }]) { r = await call(admin.PUT, "/api/admin/notify", "PUT", cookie, bad); check(`C3 a bad change ${JSON.stringify(bad)} is refused (400)`, r.status === 400, JSON.stringify(r)); }
  r = await call(admin.PUT, "/api/admin/notify", "PUT", cookie, { id: "nobody", enabled: false });
  check("C4 changing someone who does not exist is a 404", r.status === 404);
  r = await call(admin.PUT, "/api/admin/notify", "PUT", cookie, { id: person.id, topic: "tgdg-hacked-hacked-hacked-1234" });
  check("C5 the join code cannot be changed from outside", globalThis.__NDB.people[0].topic === person.topic);

  // ---- the test button
  r = await call(test.POST, "/api/admin/notify/test", "POST", cookie, { id: person.id });
  check("D0 a person with no phone connected: a plain 409 that says what to do, and nothing was sent", r.status === 409 && /has not turned on alerts/.test(r.body.error) && pushes.length === 0, JSON.stringify(r));
  const phoneA = mkSub(1);
  r = await connect(person.topic, phoneA);
  check("D0b connecting a phone with the person's code works and counts one phone", r.status === 200 && r.body.ok === true && r.body.devices === 1, JSON.stringify(r));
  check("D0c ...and a welcome message went to that phone only", pushes.length === 1 && pushes[0].sub.endpoint === phoneA.endpoint && pushes[0].payload.title === "Alerts are on");
  pushes.length = 0;
  r = await call(test.POST, "/api/admin/notify/test", "POST", cookie, { id: person.id });
  const p0 = pushes[0];
  check("D1 the test sends a title, a tap link and a plain message to the person's phone, signed with the server's keys", r.status === 200 && r.body.ok === true && p0.sub.endpoint === phoneA.endpoint && p0.payload.title === "Test from TGDG Overwatch" && p0.payload.url === "https://pro.housecallpro.com/" && /alerts reach this phone/.test(p0.payload.body) && p0.opts.vapidDetails.subject === "mailto:office@example.com" && p0.opts.vapidDetails.publicKey === keys.publicKey, JSON.stringify(pushes));
  pushes.length = 0; pushStatus = 500; { const q = console.error; console.error = () => {};
  r = await call(test.POST, "/api/admin/notify/test", "POST", cookie, { id: person.id });
  console.error = q; }
  check("D2 a failing push service gives a plain 502 message, without the service's text", r.status === 502 && /could not be reached/.test(r.body.error) && !/500/.test(JSON.stringify(r.body)), JSON.stringify(r));
  pushStatus = 201; pushes.length = 0;
  r = await call(test.POST, "/api/admin/notify/test", "POST", cookie, { id: "nobody" });
  check("D3 testing someone who does not exist is a 404 and sends nothing", r.status === 404 && pushes.length === 0);
  r = await call(test.POST, "/api/admin/notify/test", "POST", cookie, {});
  check("D4 no id is a 400", r.status === 400);
  pushStatus = 410; pushes.length = 0;
  r = await call(test.POST, "/api/admin/notify/test", "POST", cookie, { id: person.id });
  check("D5 a phone the maker says is gone (410) is forgotten, and the person is treated as having no phone", r.status === 409 && globalThis.__NDB.subs.length === 0, JSON.stringify([r, globalThis.__NDB.subs.length]));
  pushStatus = 201;
  const savedKeys = [process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY]; delete process.env.VAPID_PRIVATE_KEY;
  r = await call(test.POST, "/api/admin/notify/test", "POST", cookie, { id: person.id });
  check("D6 without the server's alert keys the test says so (503)", r.status === 503 && /keys/.test(r.body.error));
  r = await call(admin.GET, "/api/admin/notify", "GET", cookie);
  check("D7 ...and the list reports pushReady false", r.body.pushReady === false);
  [process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY] = savedKeys;
  await connect(person.topic, phoneA); pushes.length = 0;

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
  globalThis.__NDB.subs.push({ id: "s1", createdAt: 1, recipientId: "p1", endpoint: "https://fcm.googleapis.com/fcm/send/jasen-phone", p256dh: b64(65), auth: b64(16) });
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
  check("F6 inside the hours it tells Jasen about the two things he chose (the finished estimate and the long install), not the job he did not", res.status === 200 && b.ok === true && b.sent === 2 && pushes.length === 2 && pushes.every((p) => p.sub.endpoint === "https://fcm.googleapis.com/fcm/send/jasen-phone"), JSON.stringify([b, pushes.map((p) => p.payload.title)]));
  check("F7 the messages carry no link (the HCP phone app can't open web links) and no notes", pushes.length > 0 && pushes.every((p) => p.payload.url == null) && !pushes.some((p) => /4471/.test(JSON.stringify(p.payload))));
  pushes.length = 0;
  res = await ask({ authorization: "Bearer cron-secret" }, "POST"); b = await res.json();
  check("F8 asking again (POST works too) tells nobody twice", b.sent === 0 && b.alreadySent === 2 && pushes.length === 0, JSON.stringify(b));
  globalThis.__NDB.sent.clear(); pushStatus = 503; const quiet = console.error; console.error = () => {};
  res = await ask({ authorization: "Bearer cron-secret" }); b = await res.json();
  check("F9 when the push service is down (an error that is not gone) the sends are counted as failed and NOT recorded", b.failed === 2 && b.sent === 0 && globalThis.__NDB.sent.size === 0, JSON.stringify(b));
  pushStatus = 201; pushes.length = 0;
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
  globalThis.__WATCH_ERROR = false;
  globalThis.__WATCH = { ok: true, alerts: [], completed: [{ id: "csr_9#9", kind: "estimate", label: "Estimate #9", techs: ["Alex Tech"], completedAt: minAgo(2), completedLabel: "10:00 AM", minutesOnJob: 5, notes: [], url: null }] };
  globalThis.__NDB.subs = []; globalThis.__NDB.sent.clear(); pushes.length = 0;
  res = await ask({ authorization: "Bearer cron-secret" }); b = await res.json();
  check("F14 a person with no phone connected is held back (noDevice), not failed, and nothing is recorded as sent", res.status === 200 && b.sent === 0 && b.failed === 0 && b.noDevice === 1 && globalThis.__NDB.sent.size === 0, JSON.stringify(b));
  const savedPriv = process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_PRIVATE_KEY;
  res = await ask({ authorization: "Bearer cron-secret" });
  check("F15 without the alert keys the sender answers 503 and says what to set", res.status === 503 && /VAPID/.test((await res.json()).error));
  process.env.VAPID_PRIVATE_KEY = savedPriv;

  // ---- the public routes a phone uses
  reset();
  let rr = await pkey.GET();
  check("G1 the public key route returns the public key", rr.status === 200 && (await rr.json()).publicKey === keys.publicKey);
  rr = await pkey.GET(); const keyText = JSON.stringify(await rr.json());
  check("G1b ...and never the private key", !keyText.includes(keys.privateKey));
  delete process.env.VAPID_PUBLIC_KEY; rr = await pkey.GET(); check("G2 with no keys set the key route is a 503", rr.status === 503); process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  const jas = (await call(admin.POST, "/api/admin/notify", "POST", cookie, { name: "Jasen" })).body.person;
  const sub1 = mkSub(1);
  r = await connect(jas.topic, sub1);
  check("G3 a phone connects with the person's code: saved, counted, welcome sent", r.status === 200 && r.body.devices === 1 && globalThis.__NDB.subs.length === 1 && pushes.length === 1);
  r = await connect(jas.topic, sub1);
  check("G4 connecting the same phone again does not add a second copy", r.status === 200 && r.body.devices === 1 && globalThis.__NDB.subs.length === 1);
  for (let i = 2; i <= 7; i++) await connect(jas.topic, mkSub(i));
  check("G5 a person keeps at most their newest five phones", globalThis.__NDB.subs.length === 5, String(globalThis.__NDB.subs.length));
  r = await connect("tgdg-" + "z".repeat(24), mkSub(9));
  check("G6 an unknown code is a plain 404 and saves nothing", r.status === 404 && globalThis.__NDB.subs.length === 5);
  for (const bad of ["short", "../../etc", "", 5, null]) { r = await connect(bad, mkSub(9)); check(`G7 a malformed code ${JSON.stringify(bad)} is refused (404)`, r.status === 404); }
  const evil = [
    { endpoint: "https://internal.example.com/hook", keys: sub1.keys }, { endpoint: "http://fcm.googleapis.com/x", keys: sub1.keys }, { endpoint: "https://127.0.0.1/x", keys: sub1.keys },
    { endpoint: "https://fcm.googleapis.com.evil.com/x", keys: sub1.keys }, { endpoint: "https://user:pw@fcm.googleapis.com/x", keys: sub1.keys }, { endpoint: "https://fcm.googleapis.com:8443/x", keys: sub1.keys },
    { endpoint: sub1.endpoint, keys: { p256dh: "short", auth: sub1.keys.auth } }, { endpoint: sub1.endpoint, keys: { p256dh: sub1.keys.p256dh, auth: "x" } }, { endpoint: sub1.endpoint }, "text", null,
    { endpoint: "https://fcm.googleapis.com/" + "a".repeat(800), keys: sub1.keys },
  ];
  const before = globalThis.__NDB.subs.length;
  for (const sub of evil) { r = await connect(jas.topic, sub); check(`G8 a bad phone address ${JSON.stringify(sub).slice(0, 60)} is refused (400)`, r.status === 400, JSON.stringify(r)); }
  check("G9 and none of them was saved", globalThis.__NDB.subs.length === before);
  for (const host of ["web.push.apple.com", "updates.push.services.mozilla.com", "wns2-par02p.notify.windows.com"]) { r = await connect(jas.topic, { endpoint: `https://${host}/wpush/v2/abc`, keys: sub1.keys }); check(`G10 the real push service ${host} is accepted`, r.status === 200, JSON.stringify(r)); }
  rr = await psub.POST(pubReq("/api/push/subscribe", "POST", "{not json")); check("G11 broken JSON is a 400", rr.status === 400);
  rr = await psub.POST(new NextRequest("http://localhost:3000/api/push/subscribe", { method: "POST", headers: { "content-type": "text/plain" }, body: "code=x" })); check("G12 a form-style post is refused (415)", rr.status === 415);
  rr = await psub.POST(pubReq("/api/push/subscribe", "POST", JSON.stringify({ code: jas.topic, pad: "x".repeat(5000) }))); check("G13 an oversized body is refused (413)", rr.status === 413);
  delete process.env.VAPID_PRIVATE_KEY; r = await connect(jas.topic, mkSub(20)); check("G14 with no keys set connecting is a 503", r.status === 503); process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  pushStatus = 500; { const n = globalThis.__NDB.subs.length; r = await connect(jas.topic, mkSub(21)); check("G15 if the welcome message fails the phone is still saved", r.status === 200 && globalThis.__NDB.subs.length >= n); } pushStatus = 201;

  const keep = mkSub(30); await connect(jas.topic, keep); const n0 = globalThis.__NDB.subs.length;
  rr = await punsub.POST(pubReq("/api/push/unsubscribe", "POST", { code: "tgdg-" + "z".repeat(24), endpoint: keep.endpoint }));
  check("H1 turning off with the wrong code answers ok but removes nothing", (await rr.json()).ok === true && globalThis.__NDB.subs.length === n0);
  rr = await punsub.POST(pubReq("/api/push/unsubscribe", "POST", { code: jas.topic, endpoint: keep.endpoint }));
  check("H2 turning off with the right code removes that phone", (await rr.json()).ok === true && globalThis.__NDB.subs.length === n0 - 1 && !globalThis.__NDB.subs.some((x) => x.endpoint === keep.endpoint));
  rr = await punsub.POST(pubReq("/api/push/unsubscribe", "POST", { code: jas.topic, endpoint: "https://never.example.com/x" }));
  check("H3 an unknown phone is harmless (still ok)", (await rr.json()).ok === true);
  const other = (await call(admin.POST, "/api/admin/notify", "POST", cookie, { name: "Other" })).body.person; const theirs = mkSub(40); await connect(other.topic, theirs); const n1 = globalThis.__NDB.subs.length;
  await punsub.POST(pubReq("/api/push/unsubscribe", "POST", { code: jas.topic, endpoint: theirs.endpoint }));
  check("H4 one person's code cannot remove another person's phone", globalThis.__NDB.subs.length === n1);
  rr = await punsub.POST(new NextRequest("http://localhost:3000/api/push/unsubscribe", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })); check("H5 a form-style post is refused (415)", rr.status === 415);
  r = await call(admin.GET, "/api/admin/notify", "GET", cookie);
  check("H6 the admin list shows how many phones each person has", r.body.people.find((p) => p.id === other.id).devices === 1 && r.body.people.find((p) => p.id === jas.id).devices >= 1);
  await call(admin.DELETE, "/api/admin/notify", "DELETE", cookie, { id: other.id });
  check("H7 removing a person also removes their phones (so their link stops working)", !globalThis.__NDB.subs.some((x) => x.endpoint === theirs.endpoint));
  r = await connect(other.topic, mkSub(41));
  check("H8 ...and their old link is a 404", r.status === 404);

  // ---- the home-screen app description
  rr = await manifest.GET(new Request("http://localhost:3000/x"), { params: Promise.resolve({ code: jas.topic }) }); const man = await rr.json();
  check("M1 the manifest starts at this person's own setup page and is installable (standalone, icons)", rr.status === 200 && /manifest\+json/.test(rr.headers.get("content-type")) && man.start_url === `/join/${jas.topic}` && man.display === "standalone" && man.icons.some((i) => i.sizes === "512x512") && man.icons.some((i) => i.sizes === "192x192"), JSON.stringify(man));
  rr = await manifest.GET(new Request("http://localhost:3000/x"), { params: Promise.resolve({ code: "../x" }) }); check("M2 a malformed code gets no manifest (404)", rr.status === 404);

  // ---- push.ts on its own
  check("P1 pushConfig needs both keys", push.pushConfig({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_SUBJECT: "mailto:a@b.co" }) === null && push.pushConfig({}) === null);
  check("P2 pushConfig rejects junk keys", push.pushConfig({ VAPID_PUBLIC_KEY: "abc", VAPID_PRIVATE_KEY: "def", VAPID_SUBJECT: "mailto:a@b.co" }) === null);
  const base = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };
  check("P3 the subject: mailto or https as given; otherwise the Vercel production address; otherwise not ready", push.pushConfig({ ...base, VAPID_SUBJECT: "mailto:a@b.co" }).subject === "mailto:a@b.co" && push.pushConfig({ ...base, VAPID_SUBJECT: "https://x.example.com" }).subject === "https://x.example.com" && push.pushConfig({ ...base, VERCEL_PROJECT_PRODUCTION_URL: "tgdg.vercel.app" }).subject === "https://tgdg.vercel.app" && push.pushConfig({ ...base, VAPID_SUBJECT: "javascript:1" }) === null && push.pushConfig(base) === null);
  const msgOK = { title: "T", body: "x".repeat(5000), url: "https://pro.housecallpro.com/a", priority: 4, tag: "warning" };
  const pl = JSON.parse(push.payloadFor({ ...msgOK, title: "y".repeat(500) }));
  check("P4 the payload is cut to a safe size", pl.body.length === 1000 && pl.title.length === 100);
  pushes.length = 0; globalThis.__NDB.subs = [];
  await connect(jas.topic, mkSub(50)); pushes.length = 0;
  const st = { async list(id) { return id === jas.id ? globalThis.__NDB.subs.filter((x) => x.recipientId === id) : []; }, async remove(e) { globalThis.__NDB.subs = globalThis.__NDB.subs.filter((x) => x.endpoint !== e); } };
  await push.pushSender({ store: st, config: push.pushConfig(process.env) }).send({ id: jas.id, name: "J" }, msgOK);
  check("P5 an urgent message is sent with high urgency and a TTL", pushes[0].opts.urgency === "high" && pushes[0].opts.TTL > 0 && pushes[0].opts.timeout > 0);
  pushes.length = 0; await push.pushSender({ store: st, config: push.pushConfig(process.env) }).send({ id: jas.id, name: "J" }, { ...msgOK, priority: 3 });
  check("P6 a normal message is sent with normal urgency", pushes[0].opts.urgency === "normal");
  await connect(jas.topic, mkSub(51)); pushes.length = 0; const dead = globalThis.__NDB.subs[0].endpoint; pushStatus = 201; globalThis.__PUSH_STATUS = (e) => (e === dead ? 404 : 201);
  await push.pushSender({ store: st, config: push.pushConfig(process.env) }).send({ id: jas.id, name: "J" }, msgOK);
  check("P7 with two phones, one gone: the other still gets it and the gone one is forgotten, no error", pushes.length === 2 && !globalThis.__NDB.subs.some((x) => x.endpoint === dead));
  globalThis.__PUSH_STATUS = () => 201;
  let thrown = ""; try { await push.pushSender({ store: st, config: push.pushConfig(process.env) }).send({ id: "nobody", name: "N" }, msgOK); } catch (e) { thrown = e.name; }
  check("P8 a person with no phones throws NoDeviceError", thrown === "NoDeviceError");

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
