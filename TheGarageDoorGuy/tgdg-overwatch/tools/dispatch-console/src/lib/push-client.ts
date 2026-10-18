// The phone side of alerts (runs in the browser on a person's setup page). Kept free of React so it can be tested with fakes.

export interface BrowserLike {
  navigator: { userAgent?: string; platform?: string; maxTouchPoints?: number; standalone?: boolean; serviceWorker?: unknown };
  matchMedia?: (query: string) => { matches: boolean };
  PushManager?: unknown;
  Notification?: unknown;
}

export interface JoinEnv {
  /** iPhone or iPad: alerts only work from the Home Screen icon there. */
  ios: boolean;
  /** Real Safari. Only Safari reliably offers "Add to Home Screen" for this; Chrome, Facebook, Gmail, Messages previews and other in-app browsers do not. */
  safari: boolean;
  /** Running as the installed home-screen app. */
  standalone: boolean;
  /** This browser can do web push at all. */
  supported: boolean;
}

// Other browsers and in-app web views on an iPhone. Real Safari has "Version/" and "Safari/" in its user agent and none of these.
const NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|Brave|FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|Twitter|LinkedIn|Pinterest|TikTok|Messenger/;

export function detectEnv(w: BrowserLike): JoinEnv {
  const ua = w.navigator.userAgent ?? "";
  // iPadOS reports itself as a Mac but has a touch screen.
  const ios = /iPhone|iPad|iPod/.test(ua) || (w.navigator.platform === "MacIntel" && (w.navigator.maxTouchPoints ?? 0) > 1);
  const safari = /Safari\//.test(ua) && /Version\//.test(ua) && !NOT_SAFARI.test(ua);
  const standalone = w.navigator.standalone === true || (typeof w.matchMedia === "function" && w.matchMedia("(display-mode: standalone)").matches);
  const supported = Boolean(w.navigator.serviceWorker) && Boolean(w.PushManager) && Boolean(w.Notification);
  return { ios, safari, standalone, supported };
}

export function urlBase64ToUint8Array(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type Phase = "checking" | "install" | "open-safari" | "unsupported" | "ready" | "working" | "on" | "blocked" | "error";

export interface PushDeps {
  code: string;
  fetchImpl: typeof fetch;
  notification: { permission: NotificationPermission; requestPermission(): Promise<NotificationPermission> };
  serviceWorker: {
    register(url: string): Promise<{ pushManager: { subscribe(o: unknown): Promise<{ toJSON(): unknown }>; getSubscription(): Promise<{ endpoint: string; unsubscribe(): Promise<boolean>; toJSON(): unknown } | null> } }>;
    ready: Promise<unknown>;
  };
}

export type TurnOnResult = { ok: true } | { ok: false; reason: "denied" | "server" | "invalid"; message: string };

/** Asks for permission, registers this phone with its push service, and tells the server. Must be called from a tap. */
export async function turnOn(d: PushDeps): Promise<TurnOnResult> {
  const permission = await d.notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied", message: "Alerts are blocked on this phone." };
  try {
    const reg = await d.serviceWorker.register("/sw.js");
    await d.serviceWorker.ready;
    const keyRes = await d.fetchImpl("/api/push/key", { cache: "no-store" });
    if (!keyRes.ok) return { ok: false, reason: "server", message: "Alerts are not set up on the server yet. Tell the office." };
    const { publicKey } = (await keyRes.json()) as { publicKey?: string };
    if (typeof publicKey !== "string") return { ok: false, reason: "server", message: "Alerts are not set up on the server yet. Tell the office." };
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    const res = await d.fetchImpl("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: d.code, subscription: sub.toJSON() }) });
    if (res.status === 404) return { ok: false, reason: "invalid", message: "This setup link is not valid. Ask for a new one." };
    if (!res.ok) return { ok: false, reason: "server", message: "Could not finish turning alerts on. Try again in a minute." };
    return { ok: true };
  } catch {
    return { ok: false, reason: "server", message: "Could not turn alerts on. Check the internet connection and try again." };
  }
}

/** Forgets this phone, on the server and in the browser. */
export async function turnOff(d: PushDeps): Promise<void> {
  const reg = await d.serviceWorker.register("/sw.js");
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await d.fetchImpl("/api/push/unsubscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: d.code, endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** Is this phone already registered (permission granted and a live browser subscription)? */
export async function alreadyOn(d: Pick<PushDeps, "notification" | "serviceWorker">): Promise<boolean> {
  if (d.notification.permission !== "granted") return false;
  try {
    const reg = await d.serviceWorker.register("/sw.js");
    return (await reg.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}
