// Phone notifications: the rules and the orchestration. Pure logic plus two small interfaces (a store and a sender), so
// everything here is tested with in-memory fakes. The real store is notify-store.ts (the database) and the real sender
// is ntfySender below (a free push service; each person subscribes once in the ntfy app or its web page).
//
// What goes out is deliberately short and never carries a customer's name, address, phone or a job's notes: an alert
// says WHO (technician), WHAT ("Estimate #8802 ($990)"), WHEN, and carries a link that opens the ticket in Housecall Pro.
// Whoever taps the link sees the details inside Housecall Pro, behind its own sign-in.

import { randomBytes } from "node:crypto";

export const NOTIFY_KINDS = ["estimate-finished", "estimate-waiting", "job-over", "job-finished"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

export const KIND_LABEL: Record<NotifyKind, string> = {
  "estimate-finished": "Tech finished an estimate",
  "estimate-waiting": "Office estimate unanswered",
  "job-over": "Job running over time",
  "job-finished": "Tech finished a job",
};

export interface Recipient {
  id: string;
  name: string;
  /** The private channel name this person subscribes to (long and random: knowing it is what lets you read the alerts). */
  topic: string;
  kinds: NotifyKind[];
  enabled: boolean;
  createdAt: Date;
}

export interface NotifyMessage {
  title: string;
  body: string;
  /** Opens when the notification is tapped (an https Housecall Pro link) or null. */
  url: string | null;
  priority: 1 | 2 | 3 | 4 | 5;
  tag: string;
}

export interface NotifyItem {
  /** Stable for one event: a recipient is told about it once. */
  id: string;
  kind: NotifyKind;
  /** When the event happened (a finish) or became due (an alert crossing its limit). */
  eventAt: number;
  message: NotifyMessage;
}

export interface NotifyStore {
  listRecipients(): Promise<Recipient[]>;
  /** Records "this recipient was told about this event". False when it was already recorded (so two runs never double-send). */
  claim(key: string, now: Date): Promise<boolean>;
  /** Un-records a claim after a failed send, so the next run tries again. */
  release(key: string): Promise<void>;
  prune(olderThan: Date): Promise<void>;
}

export interface Sender {
  send(recipient: Pick<Recipient, "topic" | "name">, message: NotifyMessage): Promise<void>;
}

// ---- people --------------------------------------------------------------------------------------------

export const MAX_NAME = 60;

export function newTopic(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = randomBytes(24);
  let out = "";
  for (const b of bytes) out += alphabet[b % 32];
  return `tgdg-${out}`;
}

export function validTopic(t: unknown): t is string {
  return typeof t === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(t);
}

export function parseKinds(value: unknown): NotifyKind[] | null {
  if (!Array.isArray(value)) return null;
  const out: NotifyKind[] = [];
  for (const k of value) {
    if (typeof k !== "string" || !(NOTIFY_KINDS as readonly string[]).includes(k)) return null;
    if (!out.includes(k as NotifyKind)) out.push(k as NotifyKind);
  }
  return out;
}

export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= MAX_NAME ? t : null;
}

// ---- turning what Job Watch / the estimate watch found into messages ----------------------------------

interface WatchLike {
  alerts?: unknown[];
  completed?: unknown[];
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max = 80): string => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
// HTTP header values must be plain ASCII: anything else is dropped from a title (the body is sent as UTF-8).
const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim();

function names(techs: unknown): string {
  const list = (Array.isArray(techs) ? techs : []).filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 6);
  if (list.length === 0) return "A technician";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function safeUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 300 || /[\u0000- \u007f]/.test(v)) return null;
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    return host === "housecallpro.com" || host.endsWith(".housecallpro.com") ? u.href : null;
  } catch {
    return null;
  }
}

export function itemsFromWatch(watch: WatchLike): NotifyItem[] {
  const items: NotifyItem[] = [];
  for (const raw of Array.isArray(watch.alerts) ? watch.alerts : []) {
    const a = rec(raw);
    const id = str(a.id, 120);
    const started = Date.parse(str(a.startedAt, 40));
    if (!id || !Number.isFinite(started)) continue;
    const limit = num(a.limitMinutes);
    const eventAt = started + limit * 60_000; // the moment it crossed its limit
    if (a.kind === "estimate") {
      const days = Math.floor(num(a.minutesOnJob) / 1440);
      items.push({
        id, kind: "estimate-waiting", eventAt,
        message: {
          title: "Estimate waiting",
          body: `${str(a.label, 60)} has had no answer for ${days} ${days === 1 ? "day" : "days"}. Created ${str(a.startedLabel, 12) || "earlier"}${Array.isArray(a.techs) && a.techs.length ? ` (${names(a.techs)})` : ""}. No option is approved or declined yet.`,
          url: safeUrl(a.url), priority: 3, tag: "hourglass_flowing_sand",
        },
      });
    } else {
      items.push({
        id, kind: "job-over", eventAt,
        message: {
          title: "Job running long",
          body: `${names(a.techs)} ${Array.isArray(a.techs) && a.techs.length > 1 ? "have" : "has"} been on "${str(a.label, 60)}" for ${duration(num(a.minutesOnJob))} (normal is ${duration(limit)}). Started ${str(a.startedLabel, 12) || "earlier"}.`,
          url: safeUrl(a.url), priority: 4, tag: "warning",
        },
      });
    }
  }
  for (const raw of Array.isArray(watch.completed) ? watch.completed : []) {
    const c = rec(raw);
    const id = str(c.id, 120);
    const done = Date.parse(str(c.completedAt, 40));
    if (!id || !Number.isFinite(done)) continue;
    const took = c.minutesOnJob == null ? "" : ` after ${duration(num(c.minutesOnJob))}`;
    if (c.kind === "estimate") {
      const lines = (Array.isArray(c.notes) ? c.notes : []).filter((n): n is string => typeof n === "string").slice(0, 6).map((n) => n.slice(0, 80));
      items.push({
        id, kind: "estimate-finished", eventAt: done,
        message: {
          title: "Estimate finished",
          body: `${names(c.techs)} finished "${str(c.label, 60)}" at ${str(c.completedLabel, 12) || "just now"}${took}.${lines.length ? `\n${lines.join("\n")}` : ""}`,
          url: safeUrl(c.url), priority: 3, tag: "memo",
        },
      });
    } else {
      // a job's notes can hold a gate code or a name: they are never put in a message
      items.push({
        id, kind: "job-finished", eventAt: done,
        message: {
          title: "Job finished",
          body: `${names(c.techs)} finished "${str(c.label, 60)}" at ${str(c.completedLabel, 12) || "just now"}${took}. Open the job to read the notes.`,
          url: safeUrl(c.url), priority: 3, tag: "white_check_mark",
        },
      });
    }
  }
  return items;
}

// ---- who gets what -------------------------------------------------------------------------------------

/** An event older than this is not announced (a long outage should not produce a burst of old news). */
export const MAX_LAG_MS = 12 * 3_600_000;
const PRUNE_AFTER_MS = 3 * 86_400_000;

export function eligible(item: NotifyItem, who: Recipient, nowMs: number): boolean {
  if (!who.enabled || !who.kinds.includes(item.kind)) return false;
  if (item.eventAt < who.createdAt.getTime()) return false; // news from before they were added is not sent
  if (nowMs - item.eventAt > MAX_LAG_MS) return false;
  if (item.eventAt > nowMs + 10 * 60_000) return false; // a clock oddity
  return true;
}

export interface NotifyRunResult {
  recipients: number;
  items: number;
  sent: number;
  failed: number;
  alreadySent: number;
}

export async function runNotify(options: { items: NotifyItem[]; store: NotifyStore; sender: Sender; now?: () => Date; log?: (m: string) => void }): Promise<NotifyRunResult> {
  const now = (options.now ?? (() => new Date()))();
  const log = options.log ?? (() => {});
  const result: NotifyRunResult = { recipients: 0, items: options.items.length, sent: 0, failed: 0, alreadySent: 0 };
  const recipients = (await options.store.listRecipients()).filter((r) => r.enabled && r.kinds.length > 0);
  result.recipients = recipients.length;
  if (recipients.length > 0) {
    for (const who of recipients) {
      for (const item of options.items) {
        if (!eligible(item, who, now.getTime())) continue;
        const key = `${who.id}|${item.id}`;
        if (!(await options.store.claim(key, now))) {
          result.alreadySent += 1;
          continue;
        }
        try {
          await options.sender.send(who, item.message);
          result.sent += 1;
        } catch (err) {
          await options.store.release(key).catch(() => {});
          result.failed += 1;
          log(`[notify] could not send to ${who.name}: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`);
        }
      }
    }
  }
  await options.store.prune(new Date(now.getTime() - PRUNE_AFTER_MS)).catch(() => {});
  return result;
}

// ---- the sender: ntfy (free push; https://docs.ntfy.sh/publish/) ----------------------------------------

export function ntfyServer(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.NTFY_SERVER ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[^\s/]+$/i.test(raw) ? raw : "https://ntfy.sh";
}

export function ntfyRequest(server: string, topic: string, message: NotifyMessage, token?: string): { url: string; init: RequestInit } {
  if (!validTopic(topic)) throw new Error("This person has no valid notification channel.");
  const headers: Record<string, string> = {
    Title: ascii(message.title).slice(0, 80) || "Notification",
    Priority: String(message.priority),
    Tags: message.tag.replace(/[^a-z0-9_,-]/gi, ""),
  };
  if (message.url) headers.Click = message.url;
  if (token) headers.Authorization = `Bearer ${token}`;
  return { url: `${server}/${topic}`, init: { method: "POST", headers, body: message.body.slice(0, 1000) } };
}

export function ntfySender(options: { server?: string; token?: string; fetchImpl?: typeof fetch } = {}): Sender {
  const server = options.server ?? ntfyServer();
  const token = options.token ?? (process.env.NTFY_TOKEN || undefined);
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async send(recipient, message) {
      const { url, init } = ntfyRequest(server, recipient.topic, message, token);
      const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`the notification service answered ${res.status}`);
    },
  };
}

export const TEST_MESSAGE: NotifyMessage = {
  title: "Test from TGDG Overwatch",
  body: "If you can read this, notifications reach this phone. Tap to open Housecall Pro.",
  url: "https://pro.housecallpro.com/",
  priority: 3,
  tag: "bell",
};
