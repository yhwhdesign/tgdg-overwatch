import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export function hashCoachingInput(data: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

// Set below Gemini's real free-tier daily cap (1,500) so we never risk crossing it,
// even with a burst of traffic before our counter catches up.
const DAILY_CEILING = 1350;

function getTodayKey(): string {
  return new Date().toISOString().split("T")[0]; // "2026-07-20"
}

export async function canMakeAICall(): Promise<boolean> {
  // Only governs in production — local Ollama dev calls are free and unlimited.
  if (process.env.NODE_ENV !== "production") return true;

  const today = getTodayKey();
  const usage = await prisma.aIUsageLog.findUnique({ where: { date: today } });

  return (usage?.count ?? 0) < DAILY_CEILING;
}

export async function recordAICall(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;

  const today = getTodayKey();

  await prisma.aIUsageLog.upsert({
    where: { date: today },
    create: { date: today, count: 1 },
    update: { count: { increment: 1 } },
  });
}

export async function getTodayUsage(): Promise<{ count: number; ceiling: number }> {
  const today = getTodayKey();
  const usage = await prisma.aIUsageLog.findUnique({ where: { date: today } });
  return { count: usage?.count ?? 0, ceiling: DAILY_CEILING };
}