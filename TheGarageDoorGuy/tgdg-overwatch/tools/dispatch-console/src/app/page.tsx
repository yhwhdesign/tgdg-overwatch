"use client";

import { useEffect, useRef, useState } from "react";
import DockButton from "./DockButton";
import { JobWatchBars, JobWatchStatus } from "./JobWatchBars";
import SiteNav from "./SiteNav";

type CallType = "residential" | "commercial";
const CALL_TYPES: CallType[] = ["residential", "commercial"];
const CALL_TYPE_LABEL: Record<CallType, string> = { residential: "Residential", commercial: "Commercial" };

type Slot = { start: string; end: string };
type FitKind = "between-two" | "next-to-one" | "open-day" | "open";
type RouteKind = "between" | "before-first" | "after-last" | "open-day" | "unknown";
/** Where a slot sits in the tech's day and how many extra drive minutes it costs (see lib/availability.ts). */
type Route = { kind: RouteKind; minutes: number | null; fromZip: string | null; toZip: string | null };
/** The customer's location, from the address lookup (or just a zip). */
type Place = { label: string; lat: number | null; lng: number | null; zip: string | null; precision: "address" | "zip" };

/** Good fits: on his route, at most 10 extra minutes. */
const isGoodFit = (kind: FitKind) => kind === "between-two" || kind === "next-to-one";

/** A bare zip needs no lookup. */
const BARE_ZIP = /^\s*(\d{5})(-\d{4})?\s*$/;

/** lat/lng/zip for the API, in that order. A zip-only place sends just the zip. */
function locationQuery(place: Place): string {
  const parts: string[] = [];
  if (place.lat !== null && place.lng !== null) parts.push(`lat=${place.lat}`, `lng=${place.lng}`);
  if (place.zip) parts.push(`zip=${encodeURIComponent(place.zip)}`);
  return parts.join("&");
}

/** Short name for the customer's location in sentences ("near 72201"). */
function placeShort(place: Place | null): string {
  if (!place) return "the customer";
  if (place.precision === "zip" || !place.label) return place.zip ?? "the customer";
  return place.label.split(",")[0];
}

/** The customer's location for headers and the confirmation. */
function placeLine(place: Place | null): string {
  if (!place) return "";
  return place.precision === "zip" ? `Zip ${place.zip}` : place.label;
}
type BlockKind = "job" | "event";
type Neighbor = {
  kind?: BlockKind;
  label?: string | null;
  zip: string | null;
  at: string;
  near: boolean;
  sameZip: boolean;
  minutes: number | null;
};
type Gap = {
  start: string;
  end: string;
  prev: Neighbor | null;
  next: Neighbor | null;
  fit: FitKind;
  fitMinutes: number | null;
  route?: Route | null;
  slots: Slot[];
};
type Booked = { start: string; end: string; zip: string | null; kind?: BlockKind; label?: string | null };
type DayView = {
  window: { start: string; end: string };
  passedUntil: string | null;
  booked: Booked[];
  gaps: Gap[];
  slots: Slot[];
};
type DayAvailability = DayView & { date: string };
type DayResult = DayView & { date: string; cutoffPassed: boolean };
type BestFit = {
  kind: FitKind;
  date: string;
  dayLabel: "Today" | "Tomorrow" | null;
  start: string;
  end: string;
  slotStart: string;
  prevZip: string | null;
  nextZip: string | null;
  minutes: number | null;
  route?: Route | null;
};
type Soonest = { date: string; dayLabel: "Today" | "Tomorrow" | null; start: string };
type Technician = { id: string; name: string; bestFit?: BestFit | null; soonest?: Soonest | null };
type Availability = {
  timeZone: string;
  today: DayView & { cutoffPassed: boolean };
  tomorrow: DayView;
  later: { startDay: number; endDay: number; days: DayAvailability[] };
  selectable: { min: string; max: string };
  bestFit?: BestFit | null;
};

// Slot times are shown in the business time zone the API reports, so a
// dispatcher's machine clock can never shift what the customer is quoted.
function fmtTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(
    new Date(iso)
  );
}

// "YYYY-MM-DD" day labels are plain calendar dates. new Date("2026-10-07")
// parses as UTC midnight, so format in UTC too or US users see the day before.
const dayFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function fmtDay(ymd: string) {
  return dayFmt.format(new Date(ymd));
}

/** The dispatcher quotes this 2-hour window to the customer; the 1-hour slot is the actual reserved block. */
function customerWindow(slot: Slot, timeZone: string) {
  const windowEnd = new Date(new Date(slot.start).getTime() + 120 * 60000).toISOString();
  return `${fmtTime(slot.start, timeZone)}\u2013${fmtTime(windowEnd, timeZone)}`;
}

function WindowReminder() {
  return (
    <p className="rounded-md border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-xs font-semibold text-brand-orange-dark">
      Quote the customer a 2-hour arrival window &mdash; the tech&apos;s actual job block is 1 hour.
    </p>
  );
}

type Freshness = {
  state: "ok" | "stale" | "failing" | "paused" | "unknown";
  asOf: string | null;
  asOfText: string | null;
  ageMinutes: number | null;
  staleAfterMinutes: number;
  message: string;
};

function agoText(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr ago` : `${hours} hr ${rest} min ago`;
}

const STATUS_POLL_MS = 120_000;
const STATUS_TICK_MS = 30_000;

/**
 * "Schedule as of 3:26 PM · 4 min ago". Turns amber when the data is old and red when refreshing is failing,
 * so a dispatcher never trusts old data without knowing. It asks the server every couple of minutes (only while
 * the tab is visible) and keeps its own "minutes ago" up to date in between.
 */
function FreshnessBadge() {
  const [status, setStatus] = useState<Freshness | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/sync-status");
        if (!res.ok) throw new Error("status unavailable");
        const data = (await res.json()) as Freshness;
        if (!cancelled) {
          setStatus(data);
          setCheckFailed(false);
          setNow(Date.now()); // measure "minutes ago" from when this answer arrived, not from when the page loaded
        }
      } catch {
        if (!cancelled) setCheckFailed(true);
      }
    };
    const whenVisible = () => {
      if (document.visibilityState !== "hidden") void load();
    };
    void load();
    const poll = setInterval(whenVisible, STATUS_POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), STATUS_TICK_MS);
    document.addEventListener("visibilitychange", whenVisible);
    window.addEventListener("focus", whenVisible);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", whenVisible);
      window.removeEventListener("focus", whenVisible);
    };
  }, []);

  if (!status) {
    return checkFailed ? (
      <p data-freshness="unavailable" role="status" className="mt-3 text-xs font-semibold text-amber-300">
        &#9888; Can&apos;t check how fresh the schedule is.
      </p>
    ) : null;
  }

  // Keep the age current between server checks, and call old data old even if the server has not been asked lately.
  const age = status.asOf ? Math.max(0, Math.floor((now - new Date(status.asOf).getTime()) / 60000)) : null;
  let state = status.state;
  let text = status.message;
  if (state === "ok" && age !== null) {
    if (age > status.staleAfterMinutes) {
      state = "stale";
      text = `The schedule is ${age} minutes old. Updates may be stuck. Showing it as of ${status.asOfText}.`;
    } else {
      text = `Schedule as of ${status.asOfText} \u00b7 ${agoText(age)}`;
    }
  }

  if (state === "stale" || state === "failing") {
    const tone = state === "failing" ? "border-red-400 bg-red-500/20 text-red-100" : "border-amber-400 bg-amber-500/20 text-amber-100";
    return (
      <p data-freshness={state} role="status" className={`mt-3 rounded-md border px-3 py-2 text-xs font-semibold ${tone}`}>
        &#9888; {text}
        {checkFailed && " (Can't reach the server to re-check.)"}
      </p>
    );
  }
  const dot = state === "ok" ? "bg-green-400" : "bg-white/40";
  return (
    <p data-freshness={state} role="status" className="mt-3 flex items-center gap-2 text-xs text-white/60">
      <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span>
        {text}
        {checkFailed && " (Can't reach the server to re-check.)"}
      </span>
    </p>
  );
}

const STRIPES =
  "repeating-linear-gradient(45deg, rgba(22,20,15,0.22) 0 4px, rgba(22,20,15,0.10) 4px 8px)";
// Events (errands, time off, meetings) get their own color AND pattern, so they read apart from
// jobs even for someone who can't tell colors apart.
const EVENT_BLUE = "rgb(59, 95, 140)";
const CROSSHATCH =
  "repeating-linear-gradient(45deg, rgba(59,95,140,0.55) 0 1px, transparent 1px 6px), repeating-linear-gradient(-45deg, rgba(59,95,140,0.55) 0 1px, transparent 1px 6px)";

const isEvent = (b: Booked) => b.kind === "event";

function whenText(dayLabel: "Today" | "Tomorrow" | null, date: string) {
  return dayLabel ?? fmtDay(date);
}

function minutesText(n: Neighbor) {
  if (n.sameZip) return " (same zip)";
  return n.minutes !== null ? ` (about ${n.minutes} min away)` : "";
}

function neighborText(n: Neighbor, direction: "after" | "before"): string {
  if (n.kind === "event") return `${direction} an event${n.label ? ` (${n.label})` : ""}`;
  return `${direction} a ${n.zip ? n.zip + " " : ""}call${minutesText(n)}`;
}

function neighborLine(gap: Gap): string | null {
  const parts: string[] = [];
  if (gap.prev) parts.push(neighborText(gap.prev, "after"));
  if (gap.next) parts.push(neighborText(gap.next, "before"));
  if (parts.length === 0) return null;
  const text = parts.join(" \u00b7 ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fitBadge(kind: FitKind) {
  return kind === "between-two" ? "Between two nearby calls" : "Next to a nearby call";
}

/** "+4 min", "0 min" */
function plusMin(m: number | null | undefined) {
  return `+${m ?? 0} min`;
}

/**
 * One line on WHY this opening is (or isn't) a good fit for this customer, in route terms.
 * Null when the server didn't send route details (then the older zip wording is used).
 */
function routeText(route: Route | null | undefined, fit: FitKind): string | null {
  if (!route) return null;
  const call = (zip: string | null) => (zip ? `${zip} call` : "call");
  if (route.kind === "open-day") return "Open day: this would be his first call";
  if (route.minutes === null) return null;
  if (!isGoodFit(fit)) return `Off his route: ${plusMin(route.minutes)} of driving`;
  if (route.kind === "between") return `On his way between his ${call(route.fromZip)} and ${call(route.toZip)} (${plusMin(route.minutes)})`;
  if (route.kind === "before-first") return `Right before his first ${call(route.toZip)}, ${route.minutes} min away`;
  if (route.kind === "after-last") return `Right after his ${call(route.fromZip)}, ${route.minutes} min away`;
  return null;
}

/** The badge on a gap card. */
function gapBadge(gap: Gap): { text: string; tone: "good" | "open-day" | "far" } | null {
  if (gap.fit === "open-day") return { text: "Open day \u00b7 first call", tone: "open-day" };
  if (isGoodFit(gap.fit)) {
    if (!gap.route) return { text: fitBadge(gap.fit), tone: "good" };
    return { text: `On his route \u00b7 ${plusMin(gap.route.minutes)}`, tone: "good" };
  }
  if (gap.route && gap.route.minutes !== null) return { text: `Off his route \u00b7 ${plusMin(gap.route.minutes)}`, tone: "far" };
  return null;
}

/** The width of an element in pixels, kept current. Stays 0 when it cannot be measured, and callers then just show everything. */
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** About how wide one character of the 10px bold bar labels is. */
const LABEL_CHAR_PX = 6.4;

/** Text goes inside a block only if the whole of it fits; otherwise the block stays clean (the details are in the written line and the hover text). */
function labelFits(label: string | null | undefined, blockPercent: number, barPx: number): boolean {
  if (!label) return false;
  if (barPx === 0) return true;
  return (blockPercent / 100) * barPx >= label.length * LABEL_CHAR_PX + 10;
}

/** One day as a bar: shaded = already booked, white = open, orange = open and close to calls near the customer. */
function Timeline({ view, timeZone }: { view: DayView; timeZone: string }) {
  const [barRef, barPx] = useMeasuredWidth();
  const start = new Date(view.window.start).getTime();
  const total = new Date(view.window.end).getTime() - start;
  const place = (fromIso: string, toIso: string) => {
    const from = Math.min(Math.max(new Date(fromIso).getTime() - start, 0), total);
    const to = Math.min(Math.max(new Date(toIso).getTime() - start, 0), total);
    return { left: `${(from / total) * 100}%`, width: `${((to - from) / total) * 100}%` };
  };
  const percentOf = (fromIso: string, toIso: string) => parseFloat(place(fromIso, toIso).width);
  return (
    <div className="flex flex-col gap-1">
      <div
        ref={barRef}
        role="img"
        aria-label="Day schedule: shaded time is already booked"
        className="relative h-7 overflow-hidden rounded border border-brand-black/15 bg-white"
      >
        {view.gaps
          .filter((g) => isGoodFit(g.fit))
          .map((g, i) => (
            <div
              key={`fit-${i}`}
              data-kind="fit-gap"
              className="absolute inset-y-0 bg-brand-orange/25 ring-1 ring-inset ring-brand-orange"
              style={place(g.start, g.end)}
            />
          ))}
        {view.passedUntil && (
          <div
            data-kind="passed"
            className="absolute inset-y-0 bg-brand-black/10"
            style={place(view.window.start, view.passedUntil)}
          />
        )}
        {view.booked.map((b, i) =>
          isEvent(b) ? (
            <div
              key={`booked-${i}`}
              data-kind="event"
              title={`Event: ${b.label ?? "calendar event"}, ${fmtTime(b.start, timeZone)} to ${fmtTime(b.end, timeZone)}`}
              className="absolute inset-y-0 flex items-center justify-center overflow-hidden text-[10px] font-bold"
              style={{ ...place(b.start, b.end), backgroundColor: "rgba(59,95,140,0.20)", backgroundImage: CROSSHATCH, color: EVENT_BLUE }}
            >
              {labelFits(b.label, percentOf(b.start, b.end), barPx) ? b.label : null}
            </div>
          ) : (
            <div
              key={`booked-${i}`}
              data-kind="booked"
              title={`Booked ${fmtTime(b.start, timeZone)} to ${fmtTime(b.end, timeZone)}${b.zip ? ` (${b.zip})` : ""}`}
              className="absolute inset-y-0 flex items-center justify-center overflow-hidden text-[10px] font-bold text-brand-black/70"
              style={{ ...place(b.start, b.end), backgroundImage: STRIPES }}
            >
              {labelFits(b.zip, percentOf(b.start, b.end), barPx) ? b.zip : null}
            </div>
          )
        )}
      </div>
      <div className="flex justify-between text-[10px] font-semibold uppercase tracking-wide text-brand-gray">
        <span>{fmtTime(view.window.start, timeZone)}</span>
        <span>{fmtTime(view.window.end, timeZone)}</span>
      </div>
    </div>
  );
}

/** What is blocking this person that is NOT a job, written out so nobody has to guess. */
function EventNotes({ view, timeZone }: { view: DayView; timeZone: string }) {
  const events = view.booked.filter(isEvent);
  if (events.length === 0) return null;
  return (
    <ul data-kind="event-notes" className="flex flex-col gap-1">
      {events.map((e, i) => (
        <li key={i} className="flex items-start gap-2 text-xs font-semibold" style={{ color: EVENT_BLUE }}>
          <span
            aria-hidden="true"
            className="mt-0.5 inline-block h-3 w-4 shrink-0 rounded-sm border"
            style={{ backgroundColor: "rgba(59,95,140,0.20)", backgroundImage: CROSSHATCH, borderColor: EVENT_BLUE }}
          />
          <span>
            Event {fmtTime(e.start, timeZone)} &ndash; {fmtTime(e.end, timeZone)}: {e.label ?? "calendar event"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A day's timeline plus its open gaps (only open time is ever clickable). */
function DayBlock({
  view,
  timeZone,
  onPick,
  reminder,
  emptyText,
}: {
  view: DayView;
  timeZone: string;
  onPick: (slot: Slot) => void;
  reminder: boolean;
  /** Shown when the day has no open time (it may still have events worth showing). */
  emptyText?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {reminder && view.gaps.length > 0 && <WindowReminder />}
      <Timeline view={view} timeZone={timeZone} />
      <EventNotes view={view} timeZone={timeZone} />
      {view.gaps.length === 0 && emptyText && <p className="text-sm text-brand-gray">{emptyText}</p>}
      {view.gaps.map((gap, gi) => {
        const first = gap.slots[0];
        const last = gap.slots[gap.slots.length - 1];
        const line = neighborLine(gap);
        const why = routeText(gap.route, gap.fit);
        const badge = gapBadge(gap);
        const good = isGoodFit(gap.fit);
        // With route details, highlight the start time the server suggests (flush against the job he is
        // closer to); without them, the start times flush against any nearby call (the older rule).
        const suggestedEdge =
          gap.route?.kind === "before-first" ||
          (gap.route?.kind === "between" && gap.next?.minutes != null && gap.prev?.minutes != null && gap.next.minutes < gap.prev.minutes)
            ? last
            : first;
        return (
          <div
            key={gi}
            data-kind="gap"
            data-fit={gap.fit}
            className={`flex flex-col gap-2 rounded-md border-2 bg-white p-3 ${
              good ? "border-brand-orange" : gap.fit === "open-day" ? "border-sky-700/40" : "border-brand-black/10"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-black uppercase tracking-wide text-brand-black">
                Open {fmtTime(gap.start, timeZone)} &ndash; {fmtTime(gap.end, timeZone)}
              </p>
              {badge && (
                <span
                  data-kind="gap-badge"
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    badge.tone === "good"
                      ? "bg-brand-orange text-brand-black"
                      : badge.tone === "open-day"
                        ? "bg-sky-800 text-white"
                        : "bg-brand-black/10 text-brand-gray"
                  }`}
                >
                  {badge.text}
                </span>
              )}
            </div>
            {why && <p data-kind="route-why" className={`text-xs font-semibold ${good ? "text-brand-orange-dark" : "text-brand-gray"}`}>{why}</p>}
            {line && <p className="text-xs text-brand-gray">{line}</p>}
            <div className="flex flex-wrap gap-2">
              {gap.slots.map((s, i) => {
                const stacks = gap.route
                  ? good && s === suggestedEdge
                  : good && ((gap.prev?.near && s === first) || (gap.next?.near && s === last));
                return (
                  <button
                    key={i}
                    onClick={() => onPick(s)}
                    title={stacks ? (gap.route ? "Best start time for his route" : "Fits right against a nearby call") : undefined}
                    className={`rounded-md border-2 px-3 py-2 text-sm font-semibold text-brand-black hover:border-brand-orange ${
                      stacks ? "border-brand-orange bg-brand-orange/10" : "border-brand-black/10 bg-white"
                    }`}
                  >
                    {fmtTime(s.start, timeZone)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DispatchConsole() {
  const [step, setStep] = useState<"address" | "type" | "tech" | "times" | "confirmed">("address");
  // What the dispatcher typed, and where it was found on the map.
  const [address, setAddress] = useState("");
  const [place, setPlace] = useState<Place | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const zip = place?.zip ?? "";
  const near = placeShort(place);
  const [callType, setCallType] = useState<CallType | null>(null);
  const [listTimeZone, setListTimeZone] = useState<string | undefined>(undefined);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [suggestedTechnicianId, setSuggestedTechnicianId] = useState<string | null>(null);
  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const [technicianName, setTechnicianName] = useState<string>("");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [confirmed, setConfirmed] = useState<
    { label: string; window: string; technicianId: string } | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [pickedDate, setPickedDate] = useState("");
  const [dayResult, setDayResult] = useState<DayResult | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  // Find the address on the map once, then move on. A bare zip skips the lookup (works like before).
  async function handleAddressSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTypeError(null);
    setLookupError(null);
    const bare = BARE_ZIP.exec(address);
    if (bare) {
      setPlace({ label: `Zip ${bare[1]}`, lat: null, lng: null, zip: bare[1], precision: "zip" });
      setStep("type");
      return;
    }
    if (!address.trim()) {
      setLookupError("Type the customer's address.");
      return;
    }
    setLookingUp(true);
    try {
      const res = await fetch(`/api/geocode?address=${encodeURIComponent(address.trim())}`);
      const data = await res.json();
      if (!res.ok || !data.place) {
        setLookupError(data.error ?? "Couldn't find that address.");
        return;
      }
      setPlace(data.place as Place);
      setStep("type");
    } catch {
      setLookupError("Could not reach the server.");
    } finally {
      setLookingUp(false);
    }
  }

  async function handleTypeSelect(type: CallType) {
    setCallType(type);
    setTypeError(null);
    setTechnicianId(null);
    setTechnicianName("");
    setLoading(true);
    try {
      if (!place) return;
      const res = await fetch(`/api/offered-technicians?${locationQuery(place)}&type=${type}`);
      const data = await res.json();
      if (!res.ok) {
        setTypeError(data.error ?? "Could not look up technicians.");
        return;
      }
      setTechnicians(data.technicians ?? []);
      setSuggestedTechnicianId(data.suggestedTechnicianId ?? null);
      setListTimeZone(data.timeZone ?? undefined);
      setStep("tech");
    } catch {
      setTypeError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  // The breadcrumb under the page title: location, then call type, then technician.
  function headerLine() {
    const parts: string[] = [];
    if (step !== "address") parts.push(placeLine(place));
    if (callType && (step === "tech" || step === "times" || step === "confirmed")) {
      parts.push(CALL_TYPE_LABEL[callType]);
    }
    if (technicianName && (step === "times" || step === "confirmed")) parts.push(technicianName);
    return parts.join(" \u00b7 ");
  }

  async function handleTechSelect(tech: Technician) {
    setTechnicianId(tech.id);
    setTechnicianName(tech.name);
    setPickedDate("");
    setDayResult(null);
    setDayError(null);
    setLoading(true);
    const res = await fetch(`/api/availability?technicianId=${tech.id}${place ? `&${locationQuery(place)}` : ""}`);
    const data = await res.json();
    setAvailability(data);
    setStep("times");
    setLoading(false);
  }

  function handleSlotPick(label: string, slot: Slot) {
    if (!technicianId || !availability) return;
    setConfirmed({ label, window: customerWindow(slot, availability.timeZone), technicianId });
    setStep("confirmed");
  }

  function reset() {
    setStep("address");
    setAddress("");
    setPlace(null);
    setLookupError(null);
    setTechnicians([]);
    setSuggestedTechnicianId(null);
    setTechnicianId(null);
    setAvailability(null);
    setConfirmed(null);
    setPickedDate("");
    setDayResult(null);
    setDayError(null);
    setCallType(null);
    setTypeError(null);
  }

  async function handleDayPick(date: string) {
    setPickedDate(date);
    setDayResult(null);
    setDayError(null);
    if (!date || !technicianId) return;
    setDayLoading(true);
    try {
      const res = await fetch(
        `/api/availability?technicianId=${encodeURIComponent(technicianId)}${place ? `&${locationQuery(place)}` : ""}&date=${encodeURIComponent(date)}`
      );
      const data = await res.json();
      if (!res.ok) setDayError(data.error ?? "Could not load that day.");
      else setDayResult(data);
    } catch {
      setDayError("Could not reach the server.");
    } finally {
      setDayLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-brand-cream">
      <JobWatchBars />
      <SiteNav />
      <div className="bg-brand-black px-6 py-8">
        <div className="mx-auto max-w-lg">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-orange">
              The Garage Door Guy Corp
            </p>
            <DockButton />
          </div>
          <h1 className="mt-2 text-2xl font-black uppercase leading-tight text-white">
            Dispatch console
          </h1>
          {step !== "address" && (
            <p className="mt-1 text-sm text-white/70">{headerLine()}</p>
          )}
          <FreshnessBadge />
          <JobWatchStatus />
        </div>
      </div>

      <div className="mx-auto w-full max-w-lg flex-1 px-6 py-8">
        {step === "address" && (
          <form onSubmit={handleAddressSubmit} className="flex flex-col gap-4">
            <label htmlFor="customer-address" className="text-xs font-bold uppercase tracking-wide text-brand-gray">
              Customer address
            </label>
            <input
              id="customer-address"
              className="rounded-md border-2 border-brand-black/10 bg-white px-4 py-3 text-lg font-semibold text-brand-black outline-none focus:border-brand-orange"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value.slice(0, 200));
                setLookupError(null);
              }}
              placeholder="123 Main St, Little Rock, AR 72201"
              autoComplete="off"
              required
              autoFocus
            />
            <p className="text-xs text-brand-gray">
              Street, city and zip work best. A zip code by itself still works.
            </p>
            {lookupError && <p className="text-sm font-semibold text-brand-orange-dark">{lookupError}</p>}
            <button
              type="submit"
              disabled={lookingUp}
              className="rounded-md bg-brand-orange px-4 py-3 text-sm font-bold uppercase tracking-wide text-brand-black transition hover:bg-brand-orange-dark disabled:opacity-50"
            >
              {lookingUp ? "Finding address\u2026" : "Continue"}
            </button>
          </form>
        )}

        {step === "type" && (
          <div className="flex flex-col gap-4">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-orange">
              {placeLine(place)}
            </p>
            {place && place.precision === "zip" && BARE_ZIP.exec(address) === null && (
              <p data-kind="zip-fallback" className="rounded-md border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-xs font-semibold text-brand-orange-dark">
                Couldn&apos;t pin down the street address, so this uses the zip code only. Distances will be rougher.
              </p>
            )}
            <h2 className="text-xl font-black uppercase text-brand-black">What kind of call?</h2>
            <div className="grid grid-cols-2 gap-3">
              {CALL_TYPES.map((type) => (
                <button
                  key={type}
                  disabled={loading}
                  onClick={() => handleTypeSelect(type)}
                  className="rounded-md border-2 border-brand-black/10 bg-white px-4 py-10 text-center text-base font-black uppercase tracking-wide text-brand-black transition hover:border-brand-orange disabled:opacity-50"
                >
                  {CALL_TYPE_LABEL[type]}
                </button>
              ))}
            </div>
            {loading && <p className="text-sm text-brand-gray">Checking&hellip;</p>}
            {typeError && <p className="text-sm font-semibold text-brand-orange-dark">{typeError}</p>}
            <button
              onClick={() => setStep("address")}
              className="mt-2 self-start text-xs font-bold uppercase tracking-wide text-brand-gray hover:text-brand-black"
            >
              &larr; Back to address
            </button>
          </div>
        )}

        {step === "tech" && (
          <div className="flex flex-col gap-4">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-orange">
              {callType ? CALL_TYPE_LABEL[callType] : ""} &middot; {placeLine(place)}
            </p>
            <h2 className="text-xl font-black uppercase text-brand-black">
              Pick a technician
            </h2>
            {technicians.length === 0 && (
              <p className="text-sm text-brand-gray">
                No technicians are marked for {callType} calls yet. That is set on the Admin screen.
              </p>
            )}
            <div className="flex flex-col divide-y divide-brand-black/10 border-t border-brand-black/10">
              {technicians.map((t) => {
                const best = t.bestFit;
                const stacks = best && isGoodFit(best.kind);
                const openDay = best && best.kind === "open-day";
                const why = best ? routeText(best.route, best.kind) : null;
                const earlier = (stacks || openDay) && t.soonest && best && new Date(t.soonest.start) < new Date(best.slotStart);
                return (
                  <button
                    key={t.id}
                    onClick={() => handleTechSelect(t)}
                    className="flex items-start gap-3 py-4 text-left transition hover:bg-black/5"
                  >
                    <span className="flex flex-1 flex-col gap-1">
                      <span className="font-semibold text-brand-black">{t.name}</span>
                      {best ? (
                        stacks ? (
                          <span className="text-xs font-semibold text-brand-orange-dark">
                            {why ??
                              (best.kind === "between-two"
                                ? `Between two calls near ${near}`
                                : `Next to a call near ${near}`)}
                            : {whenText(best.dayLabel, best.date)}, open {fmtTime(best.start, listTimeZone ?? "")}{" "}
                            &ndash; {fmtTime(best.end, listTimeZone ?? "")}
                          </span>
                        ) : openDay ? (
                          <span className="text-xs font-semibold text-sky-800">
                            Open day, first call: {whenText(best.dayLabel, best.date)} from{" "}
                            {fmtTime(best.slotStart, listTimeZone ?? "")}
                          </span>
                        ) : (
                          <span className="flex flex-col gap-0.5 text-xs text-brand-gray">
                            {why && <span>{why}</span>}
                            <span>
                              Soonest opening: {whenText(best.dayLabel, best.date)}{" "}
                              {fmtTime(best.slotStart, listTimeZone ?? "")}
                            </span>
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-brand-gray">No openings in the next 7 days</span>
                      )}
                      {earlier && t.soonest && (
                        <span className="text-xs text-brand-gray">
                          Soonest opening: {whenText(t.soonest.dayLabel, t.soonest.date)}{" "}
                          {fmtTime(t.soonest.start, listTimeZone ?? "")}
                        </span>
                      )}
                    </span>
                    {t.id === suggestedTechnicianId && (
                      <span className="rounded-full bg-brand-orange px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-black">
                        Suggested
                      </span>
                    )}
                    <span aria-hidden="true" className="text-brand-black/40">
                      &rarr;
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setStep("type")}
              className="mt-2 self-start text-xs font-bold uppercase tracking-wide text-brand-gray hover:text-brand-black"
            >
              &larr; Back
            </button>
          </div>
        )}

        {step === "times" && availability && (
          <div className="flex flex-col gap-8">
            {availability.bestFit && availability.bestFit.kind !== "open" ? (
              <section className="flex flex-col gap-2 rounded-md border-2 border-brand-orange bg-brand-orange/10 p-3">
                <p className="text-xs font-black uppercase tracking-widest text-brand-orange-dark">
                  Best fit for {place?.precision === "zip" ? `zip ${zip}` : near}
                </p>
                <p className="text-sm font-semibold text-brand-black">
                  {whenText(availability.bestFit.dayLabel, availability.bestFit.date)}, open{" "}
                  {fmtTime(availability.bestFit.start, availability.timeZone)} &ndash;{" "}
                  {fmtTime(availability.bestFit.end, availability.timeZone)},{" "}
                  {routeText(availability.bestFit.route, availability.bestFit.kind)?.replace(/^./, (c) => c.toLowerCase()) ??
                    (availability.bestFit.kind === "between-two"
                      ? `between two calls near ${near}`
                      : availability.bestFit.kind === "open-day"
                        ? "open day: this would be his first call"
                        : `next to a call near ${near}`)}
                </p>
                <button
                  onClick={() => {
                    const bf = availability.bestFit;
                    if (!bf) return;
                    handleSlotPick(whenText(bf.dayLabel, bf.date), {
                      start: bf.slotStart,
                      end: new Date(new Date(bf.slotStart).getTime() + 3600000).toISOString(),
                    });
                  }}
                  className="self-start rounded-md bg-brand-orange px-3 py-2 text-sm font-bold uppercase tracking-wide text-brand-black hover:bg-brand-orange-dark"
                >
                  Book {fmtTime(availability.bestFit.slotStart, availability.timeZone)}
                </button>
              </section>
            ) : availability.bestFit ? (
              <p className="text-xs text-brand-gray">
                {availability.bestFit.route?.minutes != null
                  ? `Every opening in the next 7 days is off his route (best is ${plusMin(availability.bestFit.route.minutes)} of driving). `
                  : `No calls near ${near} to stack with in the next 7 days. `}
                Soonest opening:{" "}
                {whenText(availability.bestFit.dayLabel, availability.bestFit.date)}{" "}
                {fmtTime(availability.bestFit.slotStart, availability.timeZone)}.
              </p>
            ) : null}

            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-gray">
              <span className="flex items-center gap-1">
                <span
                  className="inline-block h-3 w-5 rounded-sm border border-brand-black/15"
                  style={{ backgroundImage: STRIPES }}
                />
                Booked
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-5 rounded-sm border border-brand-black/15 bg-white" />
                Open
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-5 rounded-sm bg-brand-orange/25 ring-1 ring-inset ring-brand-orange" />
                {place?.precision === "address" ? "Open on his route for this address" : `Open near calls in ${zip}`}
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="inline-block h-3 w-5 rounded-sm border"
                  style={{ backgroundColor: "rgba(59,95,140,0.20)", backgroundImage: CROSSHATCH, borderColor: EVENT_BLUE }}
                />
                Event (errand, time off, meeting)
              </span>
            </p>

            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-black uppercase tracking-wide text-brand-black">Today</h2>
              {availability.today.gaps.length === 0 && !availability.today.booked.some(isEvent) ? (
                <p className="text-sm text-brand-gray">
                  {availability.today.cutoffPassed
                    ? "No same-day openings left for today."
                    : "Nothing open today."}
                </p>
              ) : (
                <DayBlock
                  view={availability.today}
                  timeZone={availability.timeZone}
                  onPick={(slot) => handleSlotPick("Today", slot)}
                  reminder
                  emptyText={
                    availability.today.cutoffPassed ? "No same-day openings left for today." : "Nothing open today."
                  }
                />
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-black uppercase tracking-wide text-brand-black">Tomorrow</h2>
              {availability.tomorrow.gaps.length === 0 && !availability.tomorrow.booked.some(isEvent) ? (
                <p className="text-sm text-brand-gray">Nothing open tomorrow.</p>
              ) : (
                <DayBlock
                  view={availability.tomorrow}
                  timeZone={availability.timeZone}
                  onPick={(slot) => handleSlotPick("Tomorrow", slot)}
                  reminder
                  emptyText="Nothing open tomorrow."
                />
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-black uppercase tracking-wide text-brand-black">
                Days {availability.later.startDay}&ndash;{availability.later.endDay}
              </h2>
              {availability.later.days.every((d) => d.gaps.length === 0 && !d.booked.some(isEvent)) ? (
                <p className="text-sm text-brand-gray">
                  Nothing open through day {availability.later.endDay}. Pick a later day below.
                </p>
              ) : (
                <div className="flex flex-col gap-6">
                  {availability.later.days
                    .filter((d) => d.gaps.length > 0 || d.booked.some(isEvent))
                    .map((d) => (
                      <div key={d.date} className="flex flex-col gap-2">
                        <p className="text-xs font-bold uppercase tracking-wide text-brand-gray">
                          {fmtDay(d.date)}
                        </p>
                        <DayBlock
                          view={d}
                          timeZone={availability.timeZone}
                          onPick={(slot) => handleSlotPick(fmtDay(d.date), slot)}
                          reminder={false}
                          emptyText="Nothing open this day."
                        />
                      </div>
                    ))}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-3 border-t border-brand-black/10 pt-6">
              <h2 className="text-sm font-black uppercase tracking-wide text-brand-black">
                Need a different day?
              </h2>
              <input
                type="date"
                value={pickedDate}
                min={availability.selectable.min}
                max={availability.selectable.max}
                onChange={(e) => handleDayPick(e.target.value)}
                className="w-full rounded-md border-2 border-brand-black/10 bg-white px-3 py-2 text-sm font-semibold text-brand-black outline-none focus:border-brand-orange"
              />
              <p className="text-xs text-brand-gray">
                Up to {fmtDay(availability.selectable.max)}. Further out, check Housecall Pro directly.
              </p>
              {dayLoading && <p className="text-sm text-brand-gray">Checking&hellip;</p>}
              {dayError && <p className="text-sm font-semibold text-brand-orange-dark">{dayError}</p>}
              {dayResult &&
                (dayResult.gaps.length === 0 && !dayResult.booked.some(isEvent) ? (
                  <p className="text-sm text-brand-gray">Nothing open on {fmtDay(dayResult.date)}.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-brand-gray">
                      {fmtDay(dayResult.date)}
                    </p>
                    <DayBlock
                      view={dayResult}
                      timeZone={availability.timeZone}
                      onPick={(slot) => handleSlotPick(fmtDay(dayResult.date), slot)}
                      reminder
                      emptyText={`Nothing open on ${fmtDay(dayResult.date)}.`}
                    />
                  </div>
                ))}
            </section>

            <button
              onClick={() => setStep("tech")}
              className="self-start text-xs font-bold uppercase tracking-wide text-brand-gray hover:text-brand-black"
            >
              &larr; Change technician
            </button>
          </div>
        )}

        {step === "confirmed" && confirmed && (
          <div className="flex flex-col gap-3 pt-4">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-orange">
              Ready to confirm
            </p>
            <h2 className="text-xl font-black uppercase text-brand-black">
              {confirmed.label} with {technicianName}
            </h2>
            <p className="text-sm text-brand-gray">
              {callType ? `${CALL_TYPE_LABEL[callType]} call` : "Call"} &middot;{" "}
              {place?.precision === "address" ? place.label : `zip ${zip}`}
            </p>
            <p className="text-sm text-brand-gray">
              Quote the customer: <span className="font-bold text-brand-black">{confirmed.window}</span>
            </p>
            <p className="text-xs text-brand-gray">
              (Booking this into Housecall Pro isn&apos;t wired up yet &mdash; this just confirms the slot for now.)
            </p>
            <button
              onClick={reset}
              className="mt-2 self-start rounded-md bg-brand-orange px-4 py-2 text-sm font-bold uppercase tracking-wide text-brand-black hover:bg-brand-orange-dark"
            >
              New call
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
