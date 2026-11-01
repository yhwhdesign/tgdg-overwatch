import type { Place, ZipProximity } from "./zip-distance";

// Kept in step with zip-distance.ts (this file imports nothing at run time so the tests can load it directly).
/** A slot within this many extra minutes of driving counts as "on his route". */
const NEAR_DRIVE_MINUTES = 10;

function normalizeZip(value: string | null | undefined): string | null {
  const match = /^\s*(\d{5})/.exec(value ?? "");
  return match ? match[1] : null;
}

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
// - The default view is FIXED: today, tomorrow, days 3..7. It never reaches
//   further on its own, even if everything in it is full. A person who needs
//   a later day asks for that specific day (generateDayAvailability), limited
//   to days the HCP sync actually covers so we never show false openings.
//
// Stacking: besides the open time slots, each day also reports the BOOKED blocks (so the
// screen can shade them) and the open GAPS between calls. When the customer's location is
// supplied (an address, or at least a zip), every gap is scored by how much it would pull the
// technician OFF HIS ROUTE for that day. The business rule (decided with dispatch):
//
//   - Between two jobs A and B:  detour = drive(A -> customer) + drive(customer -> B) - drive(A -> B)
//     A customer right on his way from A to B costs ~0 extra minutes, even if A and B are far apart.
//   - Before his first job of the day:  drive(customer -> first job). He goes to the customer first.
//   - After his last job of the day:    drive(last job -> customer).
//   - Nothing on his schedule that day: "open day", the customer becomes his first call.
//
// Events (errands, time off, meetings) still block time but have no location, so the route skips
// over them and measures from the job before / to the job after.
//
// Time zones: every "day" and every business-hours boundary is computed in
// the BUSINESS time zone (env BUSINESS_TIMEZONE, default America/Chicago),
// never the server's. Serverless hosts run in UTC, so relying on the server's
// local time would shift business hours by 5-6 hours. All instants handed in
// and out are plain UTC Dates; only the day/hour arithmetic is zone-aware.

/** A job, or a Housecall Pro calendar event (an errand, time off, a meeting). */
export type BlockKind = "job" | "event";

export interface BusyBlock {
  start: Date;
  end: Date;
  /** Zip code of the job, when known. Used only to judge how near neighboring calls are. */
  zip?: string | null;
  /** The job's exact map point (from Housecall Pro), when known. Better than the zip for distances. */
  lat?: number | null;
  lng?: number | null;
  /** Defaults to "job". */
  kind?: BlockKind;
  /** Short title, for events. */
  label?: string | null;
}

export interface Slot {
  start: Date;
  end: Date;
}

/** A call already on the technician's calendar, clipped to business hours, for shading. */
export interface BookedBlock {
  start: Date;
  end: Date;
  zip: string | null;
  kind: BlockKind;
  label: string | null;
}

/**
 * How good an open gap is for this customer:
 * - "between-two": between two jobs, and adding the customer costs <= 10 extra minutes of driving.
 * - "next-to-one": before his first / after his last job, within a 10-minute drive of it.
 * - "open-day":    nothing on his schedule that day; the customer would be his first call.
 * - "open":        everything else (too far off his route, or we can't tell).
 */
export type FitKind = "between-two" | "next-to-one" | "open-day" | "open";

/** Where this gap sits in the technician's route for the day (see the rule at the top). */
export type RouteKind = "between" | "before-first" | "after-last" | "open-day" | "unknown";

export interface RouteFit {
  kind: RouteKind;
  /** Extra drive minutes this customer adds to his day (see the rule at the top). Null when unknown. */
  minutes: number | null;
  /** Zip of the job he'd come FROM (the job before the gap), if any. */
  fromZip: string | null;
  /** Zip of the job he'd go TO afterward (the job after the gap), if any. */
  toZip: string | null;
}

/** The call on one side of an open gap. */
export interface GapNeighbor {
  /** Whether the neighbor is a job or an event; an event is never "near" (it has no zip). */
  kind: BlockKind;
  /** The event's short title, when the neighbor is an event. */
  label: string | null;
  zip: string | null;
  /** When that call ends (for the call before the gap) or starts (for the call after it). */
  at: Date;
  /** Same zip as the customer, or an estimated drive of 10 minutes or less. */
  near: boolean;
  sameZip: boolean;
  /** Estimated drive minutes from the customer; null when unknown. */
  minutes: number | null;
}

/** An open stretch of the day (at least one hour) with the bookable start times inside it. */
export interface Gap {
  start: Date;
  end: Date;
  prev: GapNeighbor | null;
  next: GapNeighbor | null;
  fit: FitKind;
  /** Extra drive minutes for a good fit (between-two / next-to-one); lower is better. Null otherwise. */
  fitMinutes: number | null;
  /** The route scoring behind `fit`. Null when no customer location was supplied. */
  route: RouteFit | null;
  slots: Slot[];
}

/** Everything the screen needs to draw one day. */
export interface DayView {
  /** Business hours for the day: the span the timeline covers. */
  window: { start: Date; end: Date };
  /** Today only: the time before now, which can't be booked. */
  passedUntil: Date | null;
  booked: BookedBlock[];
  gaps: Gap[];
  /** Every bookable start time in the day (the slots inside the gaps, in order). */
  slots: Slot[];
}

export interface DayAvailability extends DayView {
  /** YYYY-MM-DD, a calendar date in the business time zone */
  date: string;
}

export interface DispatchAvailability {
  /** IANA zone the day boundaries and business hours were computed in */
  timeZone: string;
  /** The calendar dates (YYYY-MM-DD) that "today" and "tomorrow" are in the business time zone. */
  dates: { today: string; tomorrow: string };
  today: DayView & { cutoffPassed: boolean };
  tomorrow: DayView;
  later: { startDay: number; endDay: number; days: DayAvailability[] };
  /** First and last day (YYYY-MM-DD) a person may ask for specifically. */
  selectable: { min: string; max: string };
}

/** Supplying the customer's location (exact point and/or zip) turns on the route scoring. */
export interface FitOptions {
  customerZip?: string | null;
  /** The customer's exact map point, from looking up the address. */
  customerPoint?: { lat: number; lng: number } | null;
  proximity: ZipProximity;
}

function customerPlace(fit: FitOptions | undefined): Place | null {
  if (!fit) return null;
  const zip = normalizeZip(fit.customerZip);
  const point = fit.customerPoint ?? null;
  if (!zip && !point) return null;
  return { zip, lat: point?.lat ?? null, lng: point?.lng ?? null };
}

const SERVICE_BLOCK_MINUTES = 60;
const SLOT_STEP_MINUTES = 30; // candidate start times every 30 min
const LATER_TIER_START_DAY = 3;
/** The default view runs from today (day 1) through this day. */
export const VIEW_DAYS = 7;
/**
 * How far ahead a person can ask for a specific day. The HCP sync pulls exactly
 * this far, so every selectable day has real data behind it.
 */
export const SELECTABLE_DAYS_AHEAD = 30;
const MINUTE_MS = 60_000;

// ---- time zone helpers (no dependencies; built on Intl) -------------------

/** A calendar date as seen on a wall clock in the business time zone. */
interface CivilDate {
  y: number;
  m: number; // 1-12
  d: number;
}

export function businessTimeZone(): string {
  return process.env.BUSINESS_TIMEZONE || "America/Chicago";
}

function wallClockParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    h: get("hour"),
    min: get("minute"),
    s: get("second"),
  };
}

/** Minutes the zone is ahead of UTC at the given instant (negative for the US). */
function offsetMinutes(at: Date, timeZone: string): number {
  const p = wallClockParts(at, timeZone);
  const wallAsUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  const atWholeSeconds = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((wallAsUtc - atWholeSeconds) / MINUTE_MS);
}

/** The calendar date it currently is, in the business time zone. */
function civilDateOf(at: Date, timeZone: string): CivilDate {
  const p = wallClockParts(at, timeZone);
  return { y: p.y, m: p.m, d: p.d };
}

function addCivilDays(c: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(c.y, c.m - 1, c.d + days));
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

function civilKey(c: CivilDate): string {
  return `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`;
}

/** The UTC instant at which the wall clock in `timeZone` reads this date and time. */
function zonedTimeToUtc(c: CivilDate, hour: number, minute: number, timeZone: string): Date {
  const naive = Date.UTC(c.y, c.m - 1, c.d, hour, minute);
  // Two passes so a guess that lands on the other side of a DST change self-corrects.
  let utc = naive - offsetMinutes(new Date(naive), timeZone) * MINUTE_MS;
  utc = naive - offsetMinutes(new Date(utc), timeZone) * MINUTE_MS;
  return new Date(utc);
}

function parseHHMM(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

function businessHoursFor(c: CivilDate, timeZone: string): { start: Date; end: Date } {
  const startCfg = parseHHMM(process.env.BUSINESS_HOURS_START ?? "08:00");
  const endCfg = parseHHMM(process.env.BUSINESS_HOURS_END ?? "18:00");
  return {
    start: zonedTimeToUtc(c, startCfg.hour, startCfg.minute, timeZone),
    end: zonedTimeToUtc(c, endCfg.hour, endCfg.minute, timeZone),
  };
}

// ---- slot generation ------------------------------------------------------

function roundUpToStep(at: Date, stepMinutes: number): Date {
  const stepMs = stepMinutes * MINUTE_MS;
  return new Date(Math.ceil(at.getTime() / stepMs) * stepMs);
}

/** Free 60-minute slots for one business day, honoring business hours and busy blocks. */
function freeSlotsForDay(
  day: CivilDate,
  timeZone: string,
  busy: BusyBlock[],
  earliestStart?: Date
): Slot[] {
  const { start: dayStart, end: dayEnd } = businessHoursFor(day, timeZone);
  let cursor =
    earliestStart && earliestStart > dayStart
      ? roundUpToStep(earliestStart, SLOT_STEP_MINUTES)
      : dayStart;

  const dayBusy = busy
    .filter((b) => b.start < dayEnd && b.end > dayStart)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const slots: Slot[] = [];
  while (cursor.getTime() + SERVICE_BLOCK_MINUTES * MINUTE_MS <= dayEnd.getTime()) {
    const candidateEnd = new Date(cursor.getTime() + SERVICE_BLOCK_MINUTES * MINUTE_MS);
    const conflict = dayBusy.find((b) => b.start < candidateEnd && b.end > cursor);
    if (conflict) {
      cursor = roundUpToStep(conflict.end, SLOT_STEP_MINUTES);
      continue;
    }
    slots.push({ start: new Date(cursor), end: candidateEnd });
    cursor = new Date(cursor.getTime() + SLOT_STEP_MINUTES * MINUTE_MS);
  }
  return slots;
}

/** The days a person may ask for specifically: today through SELECTABLE_DAYS_AHEAD. */
export function selectableRange(now: Date): { min: string; max: string } {
  const timeZone = businessTimeZone();
  const today = civilDateOf(now, timeZone);
  return { min: civilKey(today), max: civilKey(addCivilDays(today, SELECTABLE_DAYS_AHEAD)) };
}

/**
 * The slice of HCP's calendar we mirror: from midnight today (business time zone)
 * to the end of the last selectable day. Forward-looking only: nothing earlier.
 */
export function syncWindow(now: Date): { from: Date; to: Date } {
  const timeZone = businessTimeZone();
  const today = civilDateOf(now, timeZone);
  return {
    from: zonedTimeToUtc(today, 0, 0, timeZone),
    to: zonedTimeToUtc(addCivilDays(today, SELECTABLE_DAYS_AHEAD + 1), 0, 0, timeZone),
  };
}

// ---- gaps, shading and stacking --------------------------------------------

const EPS_MS = 1; // "this call ends exactly where the gap starts"
const RECENT_PREV_MINUTES = 60; // right now, a call that just ended still counts as the one before

function zip5(value: string | null | undefined): string | null {
  return normalizeZip(value);
}

/** A booked block plus where it is. The location stays on the server: it is never sent to the screen. */
interface BookedWithPlace extends BookedBlock {
  place: Place;
}

function neighborOf(block: BookedWithPlace, at: Date, customer: Place | null, fit: FitOptions | undefined): GapNeighbor {
  // An event has no location, so it is a boundary for the gap but never a call to stack against.
  const p =
    fit && customer && block.kind === "job"
      ? fit.proximity(customer, block.place)
      : { sameZip: false, near: false, minutes: null };
  return { kind: block.kind, label: block.label, zip: block.zip, at, near: p.near, sameZip: p.sameZip, minutes: p.minutes };
}

/** Does this job have anything we can measure from (a map point or a zip)? */
function locatable(b: BookedWithPlace): boolean {
  return b.place.lat != null || !!b.place.zip;
}

/**
 * The route rule (see the top of this file) for one open gap. `jobsToday` are the day's jobs
 * (events excluded) in time order.
 */
function scoreRoute(
  gapStart: Date,
  gapEnd: Date,
  jobsToday: BookedWithPlace[],
  customer: Place,
  proximity: ZipProximity
): { fit: FitKind; fitMinutes: number | null; route: RouteFit } {
  if (jobsToday.length === 0) {
    return { fit: "open-day", fitMinutes: null, route: { kind: "open-day", minutes: null, fromZip: null, toZip: null } };
  }
  // The job he is coming FROM and the one he goes TO next (skipping events, which have no location).
  const from = [...jobsToday].reverse().find((b) => b.end <= gapStart) ?? null;
  const to = jobsToday.find((b) => b.start >= gapEnd) ?? null;
  const fromOk = from && locatable(from) ? from : null;
  const toOk = to && locatable(to) ? to : null;
  const fromZip = from?.zip ?? null;
  const toZip = to?.zip ?? null;

  // Drive minutes for each leg; null when we can't place that job (for example a zip outside Arkansas).
  const legFrom = fromOk ? proximity(fromOk.place, customer).minutes : null;
  const legTo = toOk ? proximity(customer, toOk.place).minutes : null;

  let kind: RouteKind;
  let minutes: number | null = null;
  if (legFrom !== null && legTo !== null) {
    kind = "between";
    const direct = proximity(fromOk!.place, toOk!.place).minutes;
    // Never negative: estimates can round below zero when the customer is right on the line.
    minutes = direct === null ? legFrom + legTo : Math.max(0, legFrom + legTo - direct);
  } else if (legTo !== null) {
    // Nothing usable before the gap: he goes to the customer first, then on to this job.
    kind = "before-first";
    minutes = legTo;
  } else if (legFrom !== null) {
    kind = "after-last";
    minutes = legFrom;
  } else {
    kind = "unknown";
  }

  const route: RouteFit = { kind: minutes === null ? "unknown" : kind, minutes, fromZip, toZip };
  const good = minutes !== null && minutes <= NEAR_DRIVE_MINUTES;
  if (!good) return { fit: "open", fitMinutes: null, route };
  return { fit: kind === "between" ? "between-two" : "next-to-one", fitMinutes: minutes, route };
}

/**
 * One business day: the booked blocks (to shade), the open gaps between them, and the
 * bookable start times inside each gap. Start times are every 30 minutes, plus one
 * right after the call before the gap and one that ends right as the call after it
 * begins, since those are the ones that actually stack jobs back to back.
 */
function buildDayView(
  day: CivilDate,
  timeZone: string,
  busy: BusyBlock[],
  earliest: Date | undefined,
  fit: FitOptions | undefined
): DayView {
  const window = businessHoursFor(day, timeZone);
  const freeFrom = earliest && earliest > window.start ? earliest : window.start;
  const passedUntil =
    earliest && earliest > window.start ? new Date(Math.min(earliest.getTime(), window.end.getTime())) : null;

  const customer = customerPlace(fit);
  const bookedFull: BookedWithPlace[] = busy
    .filter((b) => b.start < window.end && b.end > window.start)
    .map((b) => ({
      start: b.start < window.start ? window.start : b.start,
      end: b.end > window.end ? window.end : b.end,
      zip: b.kind === "event" ? null : zip5(b.zip),
      kind: b.kind ?? ("job" as BlockKind),
      label: b.kind === "event" ? (b.label ?? null) : null,
      place: b.kind === "event" ? {} : { zip: zip5(b.zip), lat: b.lat ?? null, lng: b.lng ?? null },
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const booked = bookedFull;
  // Every job on this day (not just inside business hours), for the route: a job that already
  // finished this morning still tells us where he is.
  const jobsToday: BookedWithPlace[] = busy
    .filter((b) => (b.kind ?? "job") === "job" && b.start < window.end && b.end > new Date(window.start.getTime() - 4 * 60 * MINUTE_MS))
    .map((b) => ({
      start: b.start,
      end: b.end,
      zip: zip5(b.zip),
      kind: "job" as BlockKind,
      label: null,
      place: { zip: zip5(b.zip), lat: b.lat ?? null, lng: b.lng ?? null },
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Open intervals = what's left of the day after the calls (and, today, after "now").
  const intervals: { start: Date; end: Date }[] = [];
  let cursor = freeFrom;
  for (const b of booked) {
    if (b.end <= cursor) continue;
    if (b.start > cursor) intervals.push({ start: cursor, end: b.start });
    cursor = b.end;
  }
  if (cursor < window.end) intervals.push({ start: cursor, end: window.end });

  const gridSlots = freeSlotsForDay(day, timeZone, busy, earliest);
  const blockMs = SERVICE_BLOCK_MINUTES * MINUTE_MS;

  const gaps: Gap[] = [];
  for (const interval of intervals) {
    if (interval.end.getTime() - interval.start.getTime() < blockMs) continue;

    const before = booked.reduce<BookedWithPlace | null>(
      (best, b) => (b.end <= interval.start && (!best || b.end > best.end) ? b : best),
      null
    );
    const after = booked.reduce<BookedWithPlace | null>(
      (best, b) => (b.start >= interval.end && (!best || b.start < best.start) ? b : best),
      null
    );
    const startsRightAfterCall = !!before && Math.abs(interval.start.getTime() - before.end.getTime()) <= EPS_MS;
    const justFinished =
      !!before &&
      interval.start.getTime() === freeFrom.getTime() &&
      !!earliest &&
      interval.start.getTime() - before.end.getTime() <= RECENT_PREV_MINUTES * MINUTE_MS;
    const prevBlock = startsRightAfterCall || justFinished ? before : null;
    const nextBlock = !!after && Math.abs(after.start.getTime() - interval.end.getTime()) <= EPS_MS ? after : null;

    // candidate starts: the 30-minute grid, plus flush against each neighboring call
    const found = new Map<number, Slot>();
    for (const slot of gridSlots) {
      if (slot.start >= interval.start && slot.end <= interval.end) found.set(slot.start.getTime(), slot);
    }
    const addSlot = (startMs: number) => {
      if (startMs >= interval.start.getTime() && startMs + blockMs <= interval.end.getTime()) {
        found.set(startMs, { start: new Date(startMs), end: new Date(startMs + blockMs) });
      }
    };
    if (startsRightAfterCall) addSlot(interval.start.getTime());
    if (nextBlock) addSlot(interval.end.getTime() - blockMs);

    const slots = [...found.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
    if (slots.length === 0) continue;

    const prev = prevBlock ? neighborOf(prevBlock, prevBlock.end, customer, fit) : null;
    const next = nextBlock ? neighborOf(nextBlock, nextBlock.start, customer, fit) : null;
    const scored =
      fit && customer
        ? scoreRoute(interval.start, interval.end, jobsToday, customer, fit.proximity)
        : { fit: "open" as FitKind, fitMinutes: null, route: null };
    gaps.push({ start: interval.start, end: interval.end, prev, next, ...scored, slots });
  }

  return {
    window,
    passedUntil,
    // Locations stay on the server.
    booked: booked.map((b) => ({ start: b.start, end: b.end, zip: b.zip, kind: b.kind, label: b.label })),
    gaps,
    slots: gaps.flatMap((g) => g.slots),
  };
}

/**
 * @param now  Current moment (injected for testability).
 * @param busy This technician's calls across the horizon being checked.
 * @param fit  Optional: the customer's zip, to score gaps by how near the neighboring calls are.
 */
export function generateDispatchAvailability(
  now: Date,
  busy: BusyBlock[],
  fit?: FitOptions
): DispatchAvailability {
  const timeZone = businessTimeZone();
  const today = civilDateOf(now, timeZone);
  const tomorrow = addCivilDays(today, 1);

  const todayView = buildDayView(today, timeZone, busy, now, fit);
  const { end: todayBusinessEnd } = businessHoursFor(today, timeZone);
  const cutoffPassed = now >= todayBusinessEnd || todayView.slots.length === 0;

  // Fixed window, day 3 through day 7. Empty days stay empty: the dispatcher
  // decides whether to look further, the software doesn't.
  const laterDays: DayAvailability[] = [];
  for (let d = LATER_TIER_START_DAY; d <= VIEW_DAYS; d++) {
    const day = addCivilDays(today, d - 1); // day 1 = today
    laterDays.push({ date: civilKey(day), ...buildDayView(day, timeZone, busy, undefined, fit) });
  }

  return {
    timeZone,
    dates: { today: civilKey(today), tomorrow: civilKey(tomorrow) },
    today: { cutoffPassed, ...todayView },
    tomorrow: buildDayView(tomorrow, timeZone, busy, undefined, fit),
    later: { startDay: LATER_TIER_START_DAY, endDay: VIEW_DAYS, days: laterDays },
    selectable: selectableRange(now),
  };
}

export interface SingleDayAvailability extends DayView {
  timeZone: string;
  /** YYYY-MM-DD, a calendar date in the business time zone */
  date: string;
  cutoffPassed: boolean;
}

/** One specific day, on request. Callers must keep `date` within selectableRange(). */
export function generateDayAvailability(
  now: Date,
  busy: BusyBlock[],
  date: string,
  fit?: FitOptions
): SingleDayAvailability {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("date must look like YYYY-MM-DD");
  const target: CivilDate = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  if (civilKey(addCivilDays(target, 0)) !== date) throw new Error("that is not a real calendar date");

  const timeZone = businessTimeZone();
  const todayKey = civilKey(civilDateOf(now, timeZone));
  if (date < todayKey) {
    return {
      timeZone,
      date,
      cutoffPassed: true,
      window: businessHoursFor(target, timeZone),
      passedUntil: null,
      booked: [],
      gaps: [],
      slots: [],
    };
  }

  const isToday = date === todayKey;
  const view = buildDayView(target, timeZone, busy, isToday ? now : undefined, fit);
  const cutoffPassed = isToday && (now >= businessHoursFor(target, timeZone).end || view.slots.length === 0);
  return { timeZone, date, cutoffPassed, ...view };
}

// ---- picking the best opening across the default view ----------------------

export interface BestFit {
  kind: FitKind;
  date: string;
  dayLabel: "Today" | "Tomorrow" | null;
  /** The open window (the whole gap). */
  start: Date;
  end: Date;
  /** The start time to suggest inside that window (flush against the job he comes from or goes to). */
  slotStart: Date;
  /** The job he'd come from / go to (zip only), when there is one. */
  prevZip: string | null;
  nextZip: string | null;
  /** Extra drive minutes for a good fit; null otherwise. */
  minutes: number | null;
  /** Where the slot sits in his day, and the extra drive minutes it costs (even when it is too far). */
  route: RouteFit | null;
}

export interface SoonestOpening {
  date: string;
  dayLabel: "Today" | "Tomorrow" | null;
  start: Date;
}

/**
 * Ranking tiers (lower is better), decided with dispatch:
 *   0. On his route: at most 10 extra minutes of driving (between two jobs, or right before/after one).
 *   1. Open day: nothing on his schedule that day, so the customer becomes his first call.
 *   2. Off his route: more than 10 extra minutes; fewer extra minutes first.
 *   3. Can't tell (no customer location, or no location on his jobs).
 * Within a tier: fewer extra minutes, then a gap between two jobs over one at the end of the day,
 * then the earlier time.
 */
function tierOf(gap: { fit: FitKind; route: RouteFit | null }): number {
  if (gap.fit === "between-two" || gap.fit === "next-to-one") return 0;
  if (gap.fit === "open-day") return 1;
  if (gap.route && gap.route.minutes !== null) return 2;
  return 3;
}

const KIND_RANK: Record<FitKind, number> = { "between-two": 0, "next-to-one": 1, "open-day": 2, open: 3 };

function daysOf(a: DispatchAvailability): { date: string; label: "Today" | "Tomorrow" | null; view: DayView }[] {
  return [
    { date: a.dates.today, label: "Today", view: a.today },
    { date: a.dates.tomorrow, label: "Tomorrow", view: a.tomorrow },
    ...a.later.days.map((d) => ({ date: d.date, label: null, view: d as DayView })),
  ];
}

/** The start time to suggest in a gap: flush before the job he goes to next when that is the only side, otherwise the first one. */
function suggestedSlot(gap: Gap): Slot {
  const last = gap.slots[gap.slots.length - 1];
  if (gap.route?.kind === "before-first" && gap.next) return last;
  // Between two jobs: book him next to whichever one the customer is closer to.
  if (gap.route?.kind === "between" && gap.next && gap.next.minutes !== null) {
    if (!gap.prev || gap.prev.kind !== "job" || (gap.prev.minutes !== null && gap.next.minutes < gap.prev.minutes)) return last;
  }
  if (!gap.route && !gap.prev?.near && gap.next?.near) return last;
  return gap.slots[0];
}

function routeMinutes(r: RouteFit | null): number {
  return r?.minutes ?? Number.POSITIVE_INFINITY;
}

/** Negative when gap `a` is the better place for this customer (time order breaks ties). */
function compareGaps(
  a: { fit: FitKind; route: RouteFit | null; at: Date },
  b: { fit: FitKind; route: RouteFit | null; at: Date }
): number {
  const ta = tierOf(a);
  const tb = tierOf(b);
  if (ta !== tb) return ta - tb;
  if (ta === 0 || ta === 2) {
    const ma = routeMinutes(a.route);
    const mb = routeMinutes(b.route);
    if (ma !== mb) return ma - mb;
  }
  return KIND_RANK[a.fit] - KIND_RANK[b.fit] || a.at.getTime() - b.at.getTime();
}

/**
 * The best place to add this customer in the default view, by the ranking tiers above.
 * Null when nothing is open.
 */
export function bestFit(a: DispatchAvailability): BestFit | null {
  let best: BestFit | null = null;
  for (const day of daysOf(a)) {
    for (const gap of day.view.gaps) {
      const slot = suggestedSlot(gap);
      const candidate: BestFit = {
        kind: gap.fit,
        date: day.date,
        dayLabel: day.label,
        start: gap.start,
        end: gap.end,
        slotStart: slot.start,
        prevZip: gap.route ? gap.route.fromZip : gap.prev?.zip ?? null,
        nextZip: gap.route ? gap.route.toZip : gap.next?.zip ?? null,
        minutes: gap.fitMinutes,
        route: gap.route,
      };
      if (!best || compareBestFit(candidate, best) < 0) best = candidate;
    }
  }
  return best;
}

/** The earliest bookable start in the default view, whatever its fit. */
export function soonestOpening(a: DispatchAvailability): SoonestOpening | null {
  for (const day of daysOf(a)) {
    if (day.view.slots.length > 0) {
      return { date: day.date, dayLabel: day.label, start: day.view.slots[0].start };
    }
  }
  return null;
}

/**
 * Orders technicians' best fits by the same tiers: on his route first (fewest extra minutes),
 * then an open day, then off his route, then unknown. Technicians with no opening at all (null)
 * go last. Negative means `a` is the better fit.
 */
export function compareBestFit(a: BestFit | null, b: BestFit | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return compareGaps(
    { fit: a.kind, route: a.route ?? null, at: a.slotStart },
    { fit: b.kind, route: b.route ?? null, at: b.slotStart }
  );
}

/** Midnight-to-midnight of one calendar day (YYYY-MM-DD) in the business time zone, as UTC instants. */
export function calendarDayBounds(date: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("date must look like YYYY-MM-DD");
  const target: CivilDate = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  if (civilKey(addCivilDays(target, 0)) !== date) throw new Error("that is not a real calendar date");
  const timeZone = businessTimeZone();
  return {
    start: zonedTimeToUtc(target, 0, 0, timeZone),
    end: zonedTimeToUtc(addCivilDays(target, 1), 0, 0, timeZone),
  };
}
