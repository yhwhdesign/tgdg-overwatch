// Sending a notification to a person's phone(s) with web push, for free and with no third-party account: each phone
// that opened the person's setup page and tapped "Turn on alerts" registered a push address with its own maker
// (Apple, Google or Mozilla), and this file posts an encrypted message to that address, signed with our own VAPID keys.
//
// Everything that touches the world is injected (the store of phones, the web-push client), so it is all tested with fakes.

import { NoDeviceError, type NotifyMessage, type Sender } from "@/lib/notify";

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushStore {
  list(recipientId: string): Promise<StoredSubscription[]>;
  /** Forgets a phone whose push address the maker said no longer exists. */
  remove(endpoint: string): Promise<void>;
}

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** "mailto:you@example.com" or an https address: push services want a way to reach whoever sends. */
  subject: string;
}

export interface WebPushClient {
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { TTL: number; urgency: "very-low" | "low" | "normal" | "high"; timeout: number; vapidDetails: { subject: string; publicKey: string; privateKey: string } },
  ): Promise<unknown>;
}

// ---- configuration -------------------------------------------------------------------------------------

const PUBLIC_KEY = /^[A-Za-z0-9_-]{80,100}$/;
const PRIVATE_KEY = /^[A-Za-z0-9_-]{40,50}$/;

/** The server's push keys, or null when they are not (correctly) set. Make them with: npx web-push generate-vapid-keys */
export function pushConfig(env: Record<string, string | undefined> = process.env): PushConfig | null {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? "").trim();
  if (!PUBLIC_KEY.test(publicKey) || !PRIVATE_KEY.test(privateKey)) return null;
  const given = (env.VAPID_SUBJECT ?? "").trim();
  const hosted = (env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
  const subject = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(given) || /^https:\/\/[^\s/]+/i.test(given) ? given : /^[a-z0-9.-]+$/i.test(hosted) ? `https://${hosted}` : "";
  return subject ? { publicKey, privateKey, subject } : null;
}

// ---- what a phone may register -------------------------------------------------------------------------

// Only the real push services are accepted. Without this, anyone holding a setup link could make the server post to any
// address they like.
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

export function validSubscription(input: unknown): StoredSubscription | null {
  if (!input || typeof input !== "object") return null;
  const o = input as { endpoint?: unknown; keys?: unknown };
  const keys = o.keys && typeof o.keys === "object" ? (o.keys as { p256dh?: unknown; auth?: unknown }) : null;
  if (typeof o.endpoint !== "string" || o.endpoint.length > 700 || !keys) return null;
  if (typeof keys.p256dh !== "string" || !/^[A-Za-z0-9_-]{86,88}$/.test(keys.p256dh)) return null;
  if (typeof keys.auth !== "string" || !/^[A-Za-z0-9_-]{22,24}$/.test(keys.auth)) return null;
  let url: URL;
  try {
    url = new URL(o.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!PUSH_HOSTS.some((re) => re.test(url.hostname.toLowerCase()))) return null;
  return { endpoint: url.href, p256dh: keys.p256dh, auth: keys.auth };
}

// ---- sending -------------------------------------------------------------------------------------------

const TTL_SECONDS = 6 * 3600; // a phone that was off for a while still gets an alert if it is back within hours
const SEND_TIMEOUT_MS = 10_000;

export function payloadFor(message: NotifyMessage): string {
  return JSON.stringify({ title: message.title.slice(0, 100), body: message.body.slice(0, 1000), url: message.url, tag: message.tag });
}

async function defaultClient(): Promise<WebPushClient> {
  const mod = await import("web-push");
  return ((mod as { default?: unknown }).default ?? mod) as unknown as WebPushClient;
}

export type SendOutcome = { ok: true } | { ok: false; gone: boolean; status: number };

export async function sendToSubscription(config: PushConfig, sub: StoredSubscription, message: NotifyMessage, client?: WebPushClient): Promise<SendOutcome> {
  const push = client ?? (await defaultClient());
  try {
    await push.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payloadFor(message), {
      TTL: TTL_SECONDS,
      urgency: message.priority >= 4 ? "high" : "normal",
      timeout: SEND_TIMEOUT_MS,
      vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
    });
    return { ok: true };
  } catch (err) {
    const status = typeof err === "object" && err !== null && typeof (err as { statusCode?: unknown }).statusCode === "number" ? (err as { statusCode: number }).statusCode : 0;
    return { ok: false, gone: status === 404 || status === 410, status };
  }
}

export function pushSender(options: { store: PushStore; config: PushConfig; client?: WebPushClient }): Sender {
  return {
    async send(recipient, message) {
      const subs = await options.store.list(recipient.id);
      if (subs.length === 0) throw new NoDeviceError();
      const outcomes = await Promise.all(subs.map((s) => sendToSubscription(options.config, s, message, options.client)));
      let delivered = 0;
      let gone = 0;
      let lastStatus = 0;
      for (let i = 0; i < outcomes.length; i++) {
        const o = outcomes[i];
        if (o.ok) delivered += 1;
        else if (o.gone) {
          gone += 1;
          await options.store.remove(subs[i].endpoint).catch(() => {});
        } else lastStatus = o.status;
      }
      if (delivered > 0) return;
      if (gone === subs.length) throw new NoDeviceError();
      throw new Error(lastStatus ? `the push service answered ${lastStatus}` : "the push service could not be reached");
    },
  };
}

export const WELCOME_MESSAGE = (name: string): NotifyMessage => ({
  title: "Alerts are on",
  body: `${name.slice(0, 60)}: this phone will now get TGDG Overwatch alerts.`,
  url: null,
  priority: 3,
  tag: "bell",
});
