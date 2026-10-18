// The console sign-in (guard in front of every request, login/logout routes, sign-in cookie) and the
// scheduled refresh route, run through the real route code. The refresh itself is a stand-in: the point
// here is WHO may start it and WHEN, not Housecall Pro (that has its own suites).
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
  const stubSync = {
    name: "stub-run-sync",
    setup(b) {
      b.onResolve({ filter: /^@\/lib\/run-sync$/ }, () => ({ path: "stub-run-sync", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
        contents: `
          export class SyncBusyError extends Error {}
          globalThis.__syncCalls = globalThis.__syncCalls || [];
          export async function runFullSync(opts) {
            globalThis.__syncCalls.push(opts.trigger);
            if (globalThis.__syncMode === "busy") throw new SyncBusyError("busy");
            if (globalThis.__syncMode === "fail") throw new TypeError("fetch failed");
            return {};
          }`,
        loader: "js",
      }));
    },
  };
  const entry = path.join(TMP, "entry-console.ts");
  fs.writeFileSync(entry, `
    export * as login from "@/app/api/console/login/route";
    export * as logout from "@/app/api/console/logout/route";
    export * as cron from "@/app/api/cron/sync/route";
    export { proxy } from "@/proxy";
    export { createConsoleSession, CONSOLE_COOKIE, CONSOLE_SESSION_DAYS } from "@/lib/console-access";
    export { createSessionValue, ADMIN_COOKIE } from "@/lib/admin-session";`);
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", alias: { "@": SRC }, external: ["next/server", "node:crypto"], plugins: [stubSync], logLevel: "silent" });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, (id) => require(id === "next/server" ? NEXT : id));
  const { login, logout, cron, proxy, createConsoleSession, CONSOLE_COOKIE, CONSOLE_SESSION_DAYS, createSessionValue, ADMIN_COOKIE } = mod.exports;
  const { NextRequest } = require(NEXT);
  const req = (url, init = {}, cookie) => new NextRequest(url, { ...init, headers: { ...(init.headers || {}), ...(cookie ? { cookie } : {}) } });
  const post = (url, body, headers = {}) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const PW = "a-long-console-password";
  const reset = () => { delete process.env.CONSOLE_PASSWORD; delete process.env.VERCEL; delete process.env.ADMIN_PASSWORD; delete process.env.CRON_SECRET; delete process.env.AUTO_SYNC_HOURS; globalThis.__syncCalls = []; globalThis.__syncMode = "ok"; };

  // ---- the guard in front of every request
  reset();
  process.env.CONSOLE_PASSWORD = PW;
  const mine = `${CONSOLE_COOKIE}=${createConsoleSession(PW)}`;
  let r = proxy(req("https://x.test/"));
  check("G1 a page with no sign-in: sent to /login, remembering where it was going", r.status === 307 && /\/login\?next=%2F$/.test(r.headers.get("location") || ""), r.headers.get("location"));
  r = proxy(req("https://x.test/reports?tab=1"));
  check("G2 the page and its query are remembered", /next=%2Freports%3Ftab%3D1$/.test(r.headers.get("location") || ""), r.headers.get("location"));
  for (const p of ["/api/job-watch", "/api/availability", "/api/offered-technicians", "/api/sync-status"]) {
    r = proxy(req("https://x.test" + p));
    check(`G3 ${p} with no sign-in: 401 JSON, no data`, r.status === 401 && r.headers.get("content-type").includes("json"), String(r.status));
  }
  r = proxy(req("https://x.test/api/job-watch", {}, mine));
  check("G4 a valid sign-in cookie lets the request through", r.headers.get("x-middleware-next") === "1", String(r.status));
  r = proxy(req("https://x.test/api/job-watch", {}, `${CONSOLE_COOKIE}=${createConsoleSession("some-OLD-password")}`));
  check("G5 a cookie signed with another password (after a password change) is refused", r.status === 401);
  r = proxy(req("https://x.test/api/job-watch", {}, `${CONSOLE_COOKIE}=${createConsoleSession(PW, Date.now() - (CONSOLE_SESSION_DAYS + 1) * 86400000)}`));
  check("G6 an expired cookie is refused", r.status === 401);
  for (const junk of ["", "garbage", ".", "9999999999999.nothex", "NaN.abc"]) {
    r = proxy(req("https://x.test/api/job-watch", {}, `${CONSOLE_COOKIE}=${junk}`));
    check(`G7 a junk cookie "${junk}" is refused without a crash`, r.status === 401);
  }
  for (const p of ["/login", "/api/console/login", "/api/webhooks/housecall", "/api/cron/sync", "/admin", "/api/admin/session", "/api/admin/login", "/favicon.ico", "/logo.svg", "/join/tgdg-abc", "/join/tgdg-abc/manifest.webmanifest", "/api/push/key", "/api/push/subscribe", "/api/push/unsubscribe", "/sw.js", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"]) {
    r = proxy(req("https://x.test" + p));
    check(`G8 ${p} does not need the console sign-in (it protects itself)`, r.headers.get("x-middleware-next") === "1", String(r.status));
  }
  r = proxy(req("https://x.test/api/job-watch-extra"));
  check("G10 a path that only STARTS like a protected-free one is still guarded", r.status === 401);
  for (const p of ["/join", "/joined/x", "/api/pushy", "/api/job-watch/join/x", "/sw.js.map", "/swXjs"]) {
    r = proxy(req("https://x.test" + p));
    check(`G9b ${p} is NOT mistaken for a phone-setup path (still needs the console sign-in)`, r.headers.get("x-middleware-next") !== "1", String(r.status));
  }
  r = proxy(req("https://x.test/administrator"));
  check("G11 /administrator is not mistaken for /admin", r.status === 307);
  r = proxy(req("https://x.test/api/administrator"));
  check("G12 /api/administrator is not mistaken for /api/admin", r.status === 401);
  process.env.ADMIN_PASSWORD = "the-admin-password";
  r = proxy(req("https://x.test/api/job-watch", {}, `${ADMIN_COOKIE}=${createSessionValue("the-admin-password")}`));
  check("G13 a signed-in Admin is let in too", r.headers.get("x-middleware-next") === "1");
  r = proxy(req("https://x.test/api/job-watch", {}, `${ADMIN_COOKIE}=${createSessionValue("not-the-admin-password")}`));
  check("G14 a forged Admin cookie is not", r.status === 401);

  reset();
  r = proxy(req("http://localhost:3000/api/job-watch"));
  check("G15 on your own computer with no CONSOLE_PASSWORD: open, as before", r.headers.get("x-middleware-next") === "1");
  process.env.VERCEL = "1";
  r = proxy(req("https://x.test/"));
  check("G16 on hosting with no CONSOLE_PASSWORD: LOCKED (503), never open", r.status === 503);
  r = proxy(req("https://x.test/api/availability"));
  check("G17 ...for the data routes too", r.status === 503);
  r = proxy(req("https://x.test/api/webhooks/housecall"));
  check("G18 ...but the webhook still reaches its own signature check", r.headers.get("x-middleware-next") === "1");
  process.env.CONSOLE_PASSWORD = "";
  r = proxy(req("https://x.test/"));
  check("G19 an EMPTY CONSOLE_PASSWORD on hosting is the same as unset: locked", r.status === 503);

  // ---- sign in / sign out
  reset();
  let res = await login.POST(post("https://x.test/api/console/login", { password: PW }));
  check("L1 with no CONSOLE_PASSWORD configured, sign-in says so (503) and sets nothing", res.status === 503 && !res.headers.get("set-cookie"));
  process.env.CONSOLE_PASSWORD = PW;
  res = await login.POST(post("https://x.test/api/console/login", { password: PW }, { "x-forwarded-for": "1.1.1.1", "x-forwarded-proto": "https" }));
  let cookie = res.headers.get("set-cookie") || "";
  check("L2 the right password signs in", res.status === 200 && cookie.includes(`${CONSOLE_COOKIE}=`), cookie);
  check("L3 the cookie is HttpOnly, SameSite=Lax, Secure on https, and lasts 30 days", /HttpOnly/i.test(cookie) && /SameSite=lax/i.test(cookie) && /Secure/i.test(cookie) && new RegExp(`Max-Age=${CONSOLE_SESSION_DAYS * 86400}`).test(cookie), cookie);
  res = await login.POST(post("http://localhost:3000/api/console/login", { password: PW }, { "x-forwarded-for": "1.1.1.2" }));
  cookie = res.headers.get("set-cookie") || "";
  check("L4 on plain http (your own computer) the cookie is not Secure, so it is kept", res.status === 200 && !/Secure/i.test(cookie), cookie);
  const value = decodeURIComponent((cookie.match(new RegExp(`${CONSOLE_COOKIE}=([^;]+)`)) || [])[1] || "");
  r = proxy(req("https://x.test/api/job-watch", {}, `${CONSOLE_COOKIE}=${value}`));
  check("L5 the cookie it hands out is accepted by the guard", r.headers.get("x-middleware-next") === "1");
  res = await login.POST(post("https://x.test/api/console/login", { password: "wrong" }, { "x-forwarded-for": "2.2.2.2" }));
  check("L6 a wrong password: 401, no cookie", res.status === 401 && !res.headers.get("set-cookie"));
  res = await login.POST(post("https://x.test/api/console/login", "not json", { "x-forwarded-for": "2.2.2.3" }));
  check("L7 a body that is not JSON: 400", res.status === 400);
  res = await login.POST(post("https://x.test/api/console/login", {}, { "x-forwarded-for": "2.2.2.4" }));
  check("L8 no password at all: 401", res.status === 401);
  res = await login.POST(post("https://x.test/api/console/login", { password: "" }, { "x-forwarded-for": "2.2.2.5" }));
  check("L9 an empty password: 401", res.status === 401);
  let last;
  for (let i = 0; i < 6; i++) last = await login.POST(post("https://x.test/api/console/login", { password: "bad" + i }, { "x-forwarded-for": "9.9.9.9" }));
  check("L10 after 5 wrong passwords from one address: 429", last.status === 429);
  res = await login.POST(post("https://x.test/api/console/login", { password: PW }, { "x-forwarded-for": "9.9.9.9" }));
  check("L11 ...even the right password is refused during the lock-out", res.status === 429);
  res = await login.POST(post("https://x.test/api/console/login", { password: PW }, { "x-forwarded-for": "8.8.8.8" }));
  check("L12 ...and another address is not affected", res.status === 200);
  check("L13 sign-in only answers POST", login.GET === undefined);
  res = await logout.POST();
  check("L14 sign-out clears the cookie", /Max-Age=0/i.test(res.headers.get("set-cookie") || "") && res.status === 200);

  // ---- the scheduled refresh
  reset();
  const call = (headers, method = "GET") => cron[method](new NextRequest("https://x.test/api/cron/sync", { method, headers }));
  res = await call({});
  check("C1 with no CRON_SECRET configured the route is off (503) and runs nothing", res.status === 503 && globalThis.__syncCalls.length === 0);
  process.env.CRON_SECRET = "cron-secret-value";
  res = await call({});
  check("C2 no Authorization header: 401, nothing runs", res.status === 401 && globalThis.__syncCalls.length === 0);
  res = await call({ authorization: "Bearer wrong" });
  check("C3 the wrong secret: 401, nothing runs", res.status === 401 && globalThis.__syncCalls.length === 0);
  res = await call({ authorization: "cron-secret-value" });
  check("C4 the secret without 'Bearer ': 401", res.status === 401 && globalThis.__syncCalls.length === 0);
  res = await cron.GET(new NextRequest("https://x.test/api/cron/sync?key=cron-secret-value"));
  check("C5 the secret in the web address does not work (it would end up in logs)", res.status === 401 && globalThis.__syncCalls.length === 0);
  process.env.AUTO_SYNC_HOURS = "0-24";
  res = await call({ authorization: "Bearer cron-secret-value" });
  let body = await res.json();
  check("C6 the right secret inside the hours: runs one refresh, marked as automatic", res.status === 200 && body.ok === true && globalThis.__syncCalls.join() === "auto", JSON.stringify(body));
  res = await call({ authorization: "Bearer cron-secret-value" }, "POST");
  check("C7 POST works too (some schedulers only POST)", res.status === 200 && globalThis.__syncCalls.length === 2);
  globalThis.__syncCalls = [];
  const hourNow = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  process.env.BUSINESS_TIMEZONE = "America/Chicago";
  const away = (hourNow + 12) % 24;
  process.env.AUTO_SYNC_HOURS = `${away}-${away + 1}`;
  res = await call({ authorization: "Bearer cron-secret-value" });
  body = await res.json();
  check("C8 outside the refresh hours: skips, runs nothing (the free database sleeps)", res.status === 200 && body.skipped && globalThis.__syncCalls.length === 0, JSON.stringify(body));
  process.env.AUTO_SYNC_HOURS = "0-24";
  globalThis.__syncMode = "busy";
  res = await call({ authorization: "Bearer cron-secret-value" });
  body = await res.json();
  check("C9 a refresh already running: reported as skipped, not an error", res.status === 200 && /already running/.test(body.skipped || ""), JSON.stringify(body));
  globalThis.__syncMode = "fail";
  res = await call({ authorization: "Bearer cron-secret-value" });
  body = await res.json();
  check("C10 a failed refresh: 500 with a safe reason and no internals", res.status === 500 && /could not be reached/.test(body.error) && !/TypeError|fetch failed/.test(JSON.stringify(body)), JSON.stringify(body));

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
