import { prisma } from "@/lib/prisma";
import { parseKinds, type NotifyStore, type Recipient } from "@/lib/notify";

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
