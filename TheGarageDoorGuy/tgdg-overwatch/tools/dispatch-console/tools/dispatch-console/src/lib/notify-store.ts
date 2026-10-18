import { prisma } from "@/lib/prisma";
import { parseKinds, type NotifyStore, type Recipient } from "@/lib/notify";
import type { PushStore, StoredSubscription } from "@/lib/push";

// The database side of phone notifications. Thin on purpose: all the rules live in notify.ts.
type Row = { id: string; name: string; topic: string; kinds: string[]; enabled: boolean; createdAt: Date };

export function toRecipient(row: Row): Recipient {
  return { id: row.id, name: row.name, topic: row.topic, kinds: parseKinds(row.kinds) ?? [], enabled: row.enabled, createdAt: row.createdAt };
}

export const databaseStore: NotifyStore = {
  async listRecipients() {
    const rows = await prisma.notifyRecipient.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(toRecipient);
  },
  async claim(key, now) {
    try {
      await prisma.notifySent.create({ data: { key, sentAt: now } });
      return true;
    } catch (err) {
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") return false; // already recorded
      throw err;
    }
  },
  async release(key) {
    await prisma.notifySent.deleteMany({ where: { key } });
  },
  async prune(olderThan) {
    await prisma.notifySent.deleteMany({ where: { sentAt: { lt: olderThan } } });
  },
};

// ---- the phones -----------------------------------------------------------------------------------------

export const MAX_DEVICES = 5;

export const databasePushStore: PushStore = {
  async list(recipientId) {
    const rows = await prisma.pushSubscription.findMany({ where: { recipientId }, select: { endpoint: true, p256dh: true, auth: true } });
    return rows;
  },
  async remove(endpoint) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  },
};

/** Saves (or moves) a phone to a person. A person keeps their newest MAX_DEVICES phones. Returns how many they have now. */
export async function saveSubscription(recipientId: string, sub: StoredSubscription): Promise<number> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { recipientId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
    update: { recipientId, p256dh: sub.p256dh, auth: sub.auth },
  });
  const all = await prisma.pushSubscription.findMany({ where: { recipientId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (all.length > MAX_DEVICES) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: all.slice(MAX_DEVICES).map((x: { id: string }) => x.id) } } });
  }
  return Math.min(all.length, MAX_DEVICES);
}
