const esbuild = require("esbuild");
const path = require("path");
const TMP = path.join(__dirname, "..", ".tmp");
require("fs").mkdirSync(TMP, { recursive: true });

const fs = require("fs");
const SRC = path.join(__dirname, "../../src");
const NEXT = path.join(__dirname, "../../node_modules/next/server.js");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
(async () => {
  const entry = path.join(TMP, "entry-session.ts");
  fs.writeFileSync(entry, `export * as route from "@/app/api/admin/session/route"; export { createSessionValue, ADMIN_COOKIE, SESSION_HOURS } from "@/lib/admin-session";`);
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", alias: { "@": SRC }, external: ["next/server", "node:crypto"], logLevel: "silent" });
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, (id) => require(id === "next/server" ? NEXT : id));
  const { route, createSessionValue, ADMIN_COOKIE, SESSION_HOURS } = mod.exports;
  const { NextRequest } = require(NEXT);
  const ask = async (cookie) => { const r = await route.GET(new NextRequest("http://localhost:3000/api/admin/session", { headers: cookie ? { cookie: `${ADMIN_COOKIE}=${cookie}` } : {} })); return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control") }; };

  process.env.ADMIN_PASSWORD = "the-real-password";
  let r = await ask(createSessionValue("the-real-password"));
  check("S1 a valid sign-in cookie: signed in", r.status === 200 && r.body.signedIn === true && r.body.enabled === true, JSON.stringify(r));
  r = await ask(null);
  check("S2 no cookie: a plain 'no' with status 200 (never a 401, so the panel can read it)", r.status === 200 && r.body.signedIn === false && r.body.enabled === true, JSON.stringify(r));
  r = await ask(createSessionValue("the-real-password", Date.now() - (SESSION_HOURS + 1) * 3600 * 1000));
  check("S3 an expired cookie (older than the session length): no", r.body.signedIn === false, JSON.stringify(r));
  const good = createSessionValue("the-real-password");
  r = await ask(good.slice(0, -4) + (good.endsWith("abcd") ? "dcba" : "abcd"));
  check("S4 a cookie with a tampered signature: no", r.body.signedIn === false);
  r = await ask(createSessionValue("some-OLD-password"));
  check("S5 a cookie signed with a different (old) password, as after a password change: no", r.body.signedIn === false);
  for (const junk of ["", "garbage", ".", "123.", ".abc", "9999999999999.nothex", "NaN.abc"]) {
    r = await ask(junk);
    check(`S6 a junk cookie "${junk}": no, and no crash`, r.status === 200 && r.body.signedIn === false, JSON.stringify(r));
  }
  r = await ask(createSessionValue("the-real-password"));
  check("S7 it tells the browser never to cache the answer", r.cache === "no-store");
  check("S8 the answer contains nothing but enabled and signedIn", JSON.stringify(Object.keys(r.body).sort()) === JSON.stringify(["enabled", "signedIn"]), JSON.stringify(r.body));
  check("S9 it only answers GET (no way to POST anything to it)", typeof route.GET === "function" && route.POST === undefined && route.PUT === undefined && route.DELETE === undefined);
  delete process.env.ADMIN_PASSWORD;
  r = await ask(createSessionValue("the-real-password"));
  check("S10 with no ADMIN_PASSWORD configured, even a cookie signed with that password is 'no', and it says admin is switched off", r.status === 200 && r.body.signedIn === false && r.body.enabled === false, JSON.stringify(r));
  process.env.ADMIN_PASSWORD = "";
  r = await ask(createSessionValue(""));
  check("S11 an EMPTY password setting never signs anyone in", r.body.signedIn === false && r.body.enabled === false, JSON.stringify(r));
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
