// Core scheduling logic for the dispatcher console: given a technician's
// busy blocks, produces same-day / next-day / "later" candidate slots.
//
// Conventions (flag if these don't match how dispatch actually thinks about it):
// - Day 1 = today, day 2 = tomorrow. The "later" tier starts at day 3
//   (today + 2) and normally runs through day 7 (today + 6).
// - Every appointment reserves a 60-minute block on the tech's calendar.
//   The 2-hour figure is NOT a scheduling unit — it's what the dispatcher
//   promises the customer as an arrival window. This module only produces
//   the underlying 1-hour blocks; the UI is responsible for surfacing the
//   "quote a 2-hour window" reminder.
// - If days 3..7 have zero open slots for this technician, the window
//   pushes forward one day at a time (3..8, then 3..9, ...) up to a hard
//   cap, rather than ever silently coming back empty.
// - TODO: this all runs in server-local time. If the business and the
//   server ever run in different time zones, business-hours math needs a
//   real IANA timezone conversion (e.g. via Intl or a date library),
//   not plain Date methods.

export interface BusyBlock {
  start: Date;
  end: Date;
}

export interface Slot {
  start: Date;
  end: Date;
}

export interface DayAvailability {
  /** YYYY-MM-DD */
  date: string;
  slots: Slot[];
}

export interface DispatchAvailability {
  today: { cutoffPassed: boolean; slots: Slot[] };
  tomorrow: { slots: Slot[] };
  later: { startDay: number; endDay: number; days: DayAvailability[] };
}

const SERVICE_BLOCK_MINUTES = 60;
const SLOT_STEP_MINUTES = 30; // candidate start times every 30 min
const LATER_TIER_START_DAY = 3;
const LATER_TIER_DEFAULT_END_DAY = 7;
const LATER_TIER_MAX_END_DAY = 21; // safety cap so the push-out search can't run forever

function parseHHMM(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

function businessHoursFor(date: Date): { start: Date; end: Date } {
  const startCfg = parseHHMM(process.env.BUSINESS_HOURS_START ?? "08:00");
  const endCfg = parseHHMM(process.env.BUSINESS_HOURS_END ?? "18:00");
  const start = new Date(date);
  start.setHours(startCfg.hour, startCfg.minute, 0, 0);
  const end = new Date(date);
  end.setHours(endCfg.hour, endCfg.minute, 0, 0);
  return { start, end };
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function roundUpToStep(date: Date, stepMinutes: number): Date {
  const d = new Date(date);
  const remainder = d.getMinutes() % stepMinutes;
  if (remainder !== 0) d.setMinutes(d.getMinutes() + (stepMinutes - remainder));
  d.setSeconds(0, 0);
  return d;
}

/** Free 60-minute slots for one calendar day, honoring business hours and busy blocks. */
function freeSlotsForDay(day: Date, busy: BusyBlock[], earliestStart?: Date): Slot[] {
  const { start: dayStart, end: dayEnd } = businessHoursFor(day);
  let cursor =
    earliestStart && earliestStart > dayStart
      ? roundUpToStep(earliestStart, SLOT_STEP_MINUTES)
      : dayStart;

  const dayBusy = busy
    .filter((b) => b.start < dayEnd && b.end > dayStart)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const slots: Slot[] = [];
  while (cursor.getTime() + SERVICE_BLOCK_MINUTES * 60000 <= dayEnd.getTime()) {
    const candidateEnd = new Date(cursor.getTime() + SERVICE_BLOCK_MINUTES * 60000);
    const conflict = dayBusy.find((b) => b.start < candidateEnd && b.end > cursor);
    if (conflict) {
      cursor = roundUpToStep(conflict.end, SLOT_STEP_MINUTES);
      continue;
    }
    slots.push({ start: new Date(cursor), end: candidateEnd });
    cursor = new Date(cursor.getTime() + SLOT_STEP_MINUTES * 60000);
  }
  return slots;
}

/**
 * @param now  Current moment (injected for testability).
 * @param busy This technician's busy blocks across the horizon being checked.
 */
export function generateDispatchAvailability(now: Date, busy: BusyBlock[]): DispatchAvailability {
  const today = new Date(now);
  const todaySlots = freeSlotsForDay(today, busy, now);
  const { end: todayBusinessEnd } = businessHoursFor(today);
  const cutoffPassed = now >= todayBusinessEnd || todaySlots.length === 0;

  const tomorrow = addDays(today, 1);
  const tomorrowSlots = freeSlotsForDay(tomorrow, busy);

  // Dynamic "later" window: start fixed at day 3, push the end forward
  // one day at a time while the window has zero open slots anywhere in it.
  let endDay = LATER_TIER_DEFAULT_END_DAY;
  let laterDays: DayAvailability[] = [];

  while (endDay <= LATER_TIER_MAX_END_DAY) {
    laterDays = [];
    for (let d = LATER_TIER_START_DAY; d <= endDay; d++) {
      const date = addDays(today, d - 1); // day 1 = today
      laterDays.push({ date: dateKey(date), slots: freeSlotsForDay(date, busy) });
    }
    const hasAnyOpening = laterDays.some((d) => d.slots.length > 0);
    if (hasAnyOpening) break;
    endDay += 1;
  }

  return {
    today: { cutoffPassed, slots: todaySlots },
    tomorrow: { slots: tomorrowSlots },
    later: { startDay: LATER_TIER_START_DAY, endDay, days: laterDays },
  };
}
