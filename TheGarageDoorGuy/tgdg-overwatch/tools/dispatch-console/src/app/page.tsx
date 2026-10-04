"use client";

import { useState } from "react";

type Technician = { id: string; name: string };
type Slot = { start: string; end: string };
type DayAvailability = { date: string; slots: Slot[] };
type Availability = {
  today: { cutoffPassed: boolean; slots: Slot[] };
  tomorrow: { slots: Slot[] };
  later: { startDay: number; endDay: number; days: DayAvailability[] };
};

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

function fmtTime(iso: string) {
  return timeFmt.format(new Date(iso));
}

/** The dispatcher quotes this 2-hour window to the customer; the 1-hour slot is the actual reserved block. */
function customerWindow(slot: Slot) {
  const start = new Date(slot.start);
  const windowEnd = new Date(start.getTime() + 120 * 60000);
  return `${timeFmt.format(start)}\u2013${timeFmt.format(windowEnd)}`;
}

function WindowReminder() {
  return (
    <p className="rounded-md border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-xs font-semibold text-brand-orange-dark">
      Quote the customer a 2-hour arrival window &mdash; the tech&apos;s actual job block is 1 hour.
    </p>
  );
}

export default function DispatchConsole() {
  const [step, setStep] = useState<"zip" | "tech" | "times" | "confirmed">("zip");
  const [zip, setZip] = useState("");
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [suggestedTechnicianId, setSuggestedTechnicianId] = useState<string | null>(null);
  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const [technicianName, setTechnicianName] = useState<string>("");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [confirmed, setConfirmed] = useState<
    { label: string; window: string; technicianId: string } | null
  >(null);
  const [loading, setLoading] = useState(false);

  async function handleZipSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch(`/api/zip-coverage?zip=${encodeURIComponent(zip)}`);
    const data = await res.json();
    setTechnicians(data.technicians ?? []);
    setSuggestedTechnicianId(data.suggestedTechnicianId ?? null);
    setStep("tech");
    setLoading(false);
  }

  async function handleTechSelect(tech: Technician) {
    setTechnicianId(tech.id);
    setTechnicianName(tech.name);
    setLoading(true);
    const res = await fetch(`/api/availability?technicianId=${tech.id}`);
    const data = await res.json();
    setAvailability(data);
    setStep("times");
    setLoading(false);
  }

  function handleSlotPick(label: string, slot: Slot) {
    if (!technicianId) return;
    setConfirmed({ label, window: customerWindow(slot), technicianId });
    setStep("confirmed");
  }

  function reset() {
    setStep("zip");
    setZip("");
    setTechnicians([]);
    setSuggestedTechnicianId(null);
    setTechnicianId(null);
    setAvailability(null);
    setConfirmed(null);
  }

  return (
    <main className="flex min-h-screen flex-col bg-brand-cream">
      <div className="bg-brand-black px-6 py-8">
        <div className="mx-auto max-w-lg">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-orange">
            The Garage Door Guy Corp
          </p>
          <h1 className="mt-2 text-2xl font-black uppercase leading-tight text-white">
            Dispatch console
          </h1>
          {technicianName && step !== "zip" && (
            <p className="mt-1 text-sm text-white/70">
              Zip {zip} &middot; {technicianName}
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-lg flex-1 px-6 py-8">
        {step === "zip" && (
          <form onSubmit={handleZipSubmit} className="flex flex-col gap-4">
            <label className="text-xs font-bold uppercase tracking-wide text-brand-gray">
              Customer zip code
            </label>
            <input
              className="rounded-md border-2 border-brand-black/10 bg-white px-4 py-3 text-lg font-semibold text-brand-black outline-none focus:border-brand-orange"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              placeholder="72201"
              required
              autoFocus
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-brand-orange px-4 py-3 text-sm font-bold uppercase tracking-wide text-brand-black transition hover:bg-brand-orange-dark disabled:opacity-50"
            >
              {loading ? "Checking..." : "Check coverage"}
            </button>
          </form>
        )}

        {step === "tech" && (
          <div className="flex flex-col gap-4">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-orange">
              Covers {zip}
            </p>
            <h2 className="text-xl font-black uppercase text-brand-black">
              Pick a technician
            </h2>
            {technicians.length === 0 && (
              <p className="text-sm text-brand-gray">
                No technician is assigned to this zip yet &mdash; check zip coverage in admin.
              </p>
            )}
            <div className="flex flex-col divide-y divide-brand-black/10 border-t border-brand-black/10">
              {technicians.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleTechSelect(t)}
                  className="flex items-center gap-3 py-4 text-left transition hover:bg-black/5"
                >
                  <span className="flex-1 font-semibold text-brand-black">{t.name}</span>
                  {t.id === suggestedTechnicianId && (
                    <span className="rounded-full bg-brand-orange px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-black">
                      Suggested
                    </span>
                  )}
                  <span aria-hidden="true" className="text-brand-black/40">
                    &rarr;
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep("zip")}
              className="mt-2 self-start text-xs font-bold uppercase tracking-wide text-brand-gray hover:text-brand-black"
            >
              &larr; Back to zip
            </button>
          </div>
        )}

        {step === "times" && availability && (
          <div className="flex flex-col gap-8">
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-black uppercase tracking-wide text-brand-black">
                Today
              </h2>
              {availability.today.slots.length === 0 ? (
                <p className="text-sm text-brand-gray">
                  {availability.today.cutoffPassed
                    ? "No same-day openings left for today."
                    : "Nothing open today."}
                </p>
              ) : (
                <>
                  <WindowReminder />
                  <div className="flex flex-wrap gap-2">
                    {availability.today.slots.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleSlotPick("Today", s)}
                        className="rounded-md border-2 border-brand-black/10 bg-white px-3 py-2 text-sm font-semibold text-brand-black hover:border-brand-orange"
                      >
                        {fmtTime(s.start)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-black uppercase tracking-wide text-brand-black">
                Tomorrow
              </h2>
              {availability.tomorrow.slots.length === 0 ? (
                <p className="text-sm text-brand-gray">Nothing open tomorrow.</p>
              ) : (
                <>
                  <WindowReminder />
                  <div className="flex flex-wrap gap-2">
                    {availability.tomorrow.slots.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleSlotPick("Tomorrow", s)}
                        className="rounded-md border-2 border-brand-black/10 bg-white px-3 py-2 text-sm font-semibold text-brand-black hover:border-brand-orange"
                      >
                        {fmtTime(s.start)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-black uppercase tracking-wide text-brand-black">
                Next available (day {availability.later.startDay}
                {availability.later.endDay !== availability.later.startDay
                  ? `\u2013${availability.later.endDay}`
                  : ""}
                )
              </h2>
              {availability.later.endDay > 7 && (
                <p className="text-xs font-semibold text-brand-gray">
                  Nearer days were fully booked &mdash; range extended to day {availability.later.endDay}.
                </p>
              )}
              <div className="flex flex-col gap-4">
                {availability.later.days
                  .filter((d) => d.slots.length > 0)
                  .map((d) => (
                    <div key={d.date} className="flex flex-col gap-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-brand-gray">
                        {dateFmt.format(new Date(d.date))}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {d.slots.map((s, i) => (
                          <button
                            key={i}
                            onClick={() => handleSlotPick(dateFmt.format(new Date(d.date)), s)}
                            className="rounded-md border-2 border-brand-black/10 bg-white px-3 py-2 text-sm font-semibold text-brand-black hover:border-brand-orange"
                          >
                            {fmtTime(s.start)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
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
