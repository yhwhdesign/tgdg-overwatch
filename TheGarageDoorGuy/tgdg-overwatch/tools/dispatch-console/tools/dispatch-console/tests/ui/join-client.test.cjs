// The phone's setup page ("Turn on alerts"), run in jsdom with the browser's push features replaced by fakes,
// for an iPhone in Safari, an installed iPhone app, Android, a phone that said no, and an old browser.
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const path = require("path");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
const SRC = path.join(__dirname, "../../src");

(async () => {
  const out = await esbuild.build({
    stdin: { contents: `export { default } from "@/app/join/[code]/JoinClient"; export * as client from "@/lib/push-client";`, resolveDir: SRC, loader: "ts" },
    bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", alias: { "@": SRC },
    nodePaths: [path.join(__dirname, "../../node_modules")], external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"], logLevel: "silent",
  });
  const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = React;
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  const JoinClient = mod.exports.default; const client = mod.exports.client;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const publicKey = require("web-push").generateVAPIDKeys().publicKey;
  const CODE = "tgdg-" + "k".repeat(24);
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

  // Builds one fake phone. `opts`: ua, standalone, push (has PushManager), permission, subscribed, keyStatus, subscribeStatus, permissionAnswer
  async function phone(opts) {
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://tgdg.example.com/join/" + CODE, pretendToBeVisual: true });
    const w = dom.window;
    Object.defineProperty(w.navigator, "userAgent", { value: opts.ua, configurable: true });
    const log = { fetches: [], registered: [], subscribeArgs: null, unsubscribed: false, asked: 0 };
    let existing = opts.subscribed ? { endpoint: "https://fcm.googleapis.com/fcm/send/abc", unsubscribe: async () => { log.unsubscribed = true; existing = null; return true; }, toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "P", auth: "A" } }) } : null;
    const reg = { pushManager: {
      async subscribe(o) { log.subscribeArgs = o; existing = { endpoint: "https://fcm.googleapis.com/fcm/send/new", unsubscribe: async () => true, toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/new", keys: { p256dh: "P", auth: "A" } }) }; return existing; },
      async getSubscription() { return existing; },
    } };
    if (opts.standalone) Object.defineProperty(w.navigator, "standalone", { value: true, configurable: true });
    if (opts.push !== false) {
      Object.defineProperty(w.navigator, "serviceWorker", { value: { register: async (u) => { log.registered.push(u); return reg; }, ready: Promise.resolve(reg) }, configurable: true });
      w.PushManager = function PushManager() {};
      w.Notification = { permission: opts.permission || "default", requestPermission: async () => { log.asked += 1; const a = opts.permissionAnswer || "granted"; w.Notification.permission = a; return a; } };
    }
    w.fetch = async (url, init = {}) => {
      log.fetches.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
      if (String(url) === "/api/push/key") return opts.keyStatus && opts.keyStatus !== 200 ? { ok: false, status: opts.keyStatus, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ publicKey }) };
      if (String(url) === "/api/push/subscribe") { const st = opts.subscribeStatus || 200; return { ok: st < 300, status: st, json: async () => ({}) }; }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    Object.assign(globalThis, { window: w, document: w.document, HTMLElement: w.HTMLElement, Event: w.Event });
    Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
    const root = createRoot(w.document.getElementById("root"));
    const wait = (ms = 15) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
    await act(async () => { root.render(React.createElement(JoinClient, { code: CODE, name: "Jasen" })); });
    await wait();
    const text = () => w.document.body.textContent.replace(/\s+/g, " ").trim();
    const phase = () => (w.document.querySelector("[data-phase]") || {}).dataset?.phase;
    const click = async (sel) => { await act(async () => { w.document.querySelector(sel).dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); await wait(30); };
    return { w, log, text, phase, click, unmount: () => act(async () => root.unmount()) };
  }

  // ---- iPhone in Safari: install first
  let p = await phone({ ua: IPHONE, push: false });
  check("J1 an iPhone in Safari is first shown how to add the page to the Home Screen", p.phase() === "install" && /Add to Home Screen/.test(p.text()) && /Share/.test(p.text()) && !p.w.document.querySelector('[data-action="on"]'), p.text());
  check("J1b it greets the person by name and never shows the private code", /For Jasen/.test(p.text()) && !p.text().includes(CODE));
  await p.unmount();

  // ---- the installed iPhone app: turn on
  p = await phone({ ua: IPHONE, standalone: true });
  check("J2 the installed iPhone app offers the Turn on alerts button", p.phase() === "ready" && !!p.w.document.querySelector('[data-action="on"]'), p.text());
  await p.click('[data-action="on"]');
  const sub = p.log.fetches.find((f) => f.url === "/api/push/subscribe");
  check("J3 tapping it asks permission, registers the service worker, fetches the key, subscribes with the real key, and tells the server with the person's code", p.log.asked === 1 && p.log.registered.includes("/sw.js") && p.log.fetches.some((f) => f.url === "/api/push/key") && p.log.subscribeArgs.userVisibleOnly === true && p.log.subscribeArgs.applicationServerKey.length === 65 && p.log.subscribeArgs.applicationServerKey[0] === 4 && sub && sub.method === "POST" && sub.body.code === CODE && sub.body.subscription.endpoint.startsWith("https://"), JSON.stringify(p.log.fetches));
  check("J4 it then says alerts are on", p.phase() === "on" && /Alerts are on/.test(p.text()));
  await p.click('[data-action="off"]');
  const un = p.log.fetches.find((f) => f.url === "/api/push/unsubscribe");
  check("J5 Turn off tells the server which phone, forgets it in the browser, and goes back to the button", un && un.body.code === CODE && un.body.endpoint === "https://fcm.googleapis.com/fcm/send/new" && p.phase() === "ready", JSON.stringify(un));
  await p.unmount();

  // ---- Android
  p = await phone({ ua: ANDROID });
  check("J6 Android needs no Home Screen step: it goes straight to the button", p.phase() === "ready" && !/Add to Home Screen/.test(p.text()));
  await p.unmount();

  // ---- said no
  p = await phone({ ua: ANDROID, permissionAnswer: "denied" });
  await p.click('[data-action="on"]');
  check("J7 if the phone says no, it explains how to allow notifications in Settings and subscribes to nothing", p.phase() === "blocked" && /Settings/.test(p.text()) && p.log.subscribeArgs === null && !p.log.fetches.some((f) => f.url === "/api/push/subscribe"), p.text());
  await p.unmount();
  p = await phone({ ua: ANDROID, permission: "denied" });
  check("J8 a phone that blocked notifications earlier is told so straight away", p.phase() === "blocked");
  await p.unmount();

  // ---- old browser
  p = await phone({ ua: ANDROID, push: false });
  check("J9 a browser with no push support says what to update", p.phase() === "unsupported" && /iOS 16\.4/.test(p.text()));
  await p.unmount();

  // ---- already on
  p = await phone({ ua: ANDROID, permission: "granted", subscribed: true });
  check("J10 a phone that already has alerts on opens straight to 'Alerts are on'", p.phase() === "on");
  await p.unmount();

  // ---- failures
  p = await phone({ ua: ANDROID, subscribeStatus: 404 });
  await p.click('[data-action="on"]');
  check("J11 a link the server does not know says so", p.phase() === "error" && /not valid/.test(p.text()) && !!p.w.document.querySelector('[data-action="on"]'), p.text());
  await p.unmount();
  p = await phone({ ua: ANDROID, keyStatus: 503 });
  await p.click('[data-action="on"]');
  check("J12 alerts not set up on the server says to tell the office, and the button stays", p.phase() === "error" && /tell the office/i.test(p.text()) && p.log.subscribeArgs === null, p.text());
  await p.unmount();
  p = await phone({ ua: ANDROID, subscribeStatus: 500 });
  await p.click('[data-action="on"]');
  check("J13 a server error says to try again, without the server's text", p.phase() === "error" && /Try again/.test(p.text()));
  await p.unmount();

  // ---- the helpers on their own
  const env = (ua, extra = {}) => client.detectEnv({ navigator: { userAgent: ua, platform: "Linux", maxTouchPoints: 0, ...extra.navigator }, matchMedia: extra.matchMedia, PushManager: extra.push ? function () {} : undefined, Notification: extra.push ? function () {} : undefined });
  check("K1 iPhone and iPad are iOS; Android is not", env(IPHONE).ios === true && env("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)").ios === true && env(ANDROID).ios === false);
  check("K2 an iPad that calls itself a Mac (touch screen) is still iOS; a real Mac is not", env("Mozilla/5.0 (Macintosh; Intel Mac OS X)", { navigator: { platform: "MacIntel", maxTouchPoints: 5 } }).ios === true && env("Mozilla/5.0 (Macintosh; Intel Mac OS X)", { navigator: { platform: "MacIntel", maxTouchPoints: 0 } }).ios === false);
  check("K3 standalone is seen from navigator.standalone or the display-mode query", env(IPHONE, { navigator: { standalone: true } }).standalone === true && env(ANDROID, { matchMedia: () => ({ matches: true }) }).standalone === true && env(ANDROID, { matchMedia: () => ({ matches: false }) }).standalone === false);
  check("K4 supported needs service workers, PushManager and Notification", env(ANDROID, { navigator: { serviceWorker: {} }, push: true }).supported === true && env(ANDROID, { navigator: { serviceWorker: {} } }).supported === false && env(ANDROID, { push: true }).supported === false);
  const bytes = client.urlBase64ToUint8Array("AQID_w");
  check("K5 the key decoder handles URL-safe base64 without padding", JSON.stringify([...bytes]) === "[1,2,3,255]", JSON.stringify([...bytes]));

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
