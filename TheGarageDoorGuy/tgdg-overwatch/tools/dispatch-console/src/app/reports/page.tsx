"use client";

import { useCallback, useEffect, useState } from "react";

// Reports (Admin only): how the company and each tech are doing, read from Housecall Pro. Read-only.
// The numbers and their rules come from src/lib/reports.ts; this page only shows them.

type Rank = "top" | "mid" | "bottom" | null;
type RangeKey = "7" | "30" | "90" | "last-month" | "ytd";
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "last-month", label: "Last month" },
  { key: "ytd", label: "This year" },
];

type Tiles = {
  revenueCents: number;
  jobs: number;
  avgTicketCents: number | null;
  revenuePerTechDayCents: number | null;
  closeRatePct: number | null;
  goBackRatePct: number | null;
  outstandingCents: number;
  afterHoursPct: number | null;
};
type Tech = {
  id: string;
  name: string;
  jobs: number;
  installs: number;
  service: number;
  smallSample: boolean;
  revenueCents: number;
  avgTicketCents: number | null;
  techDays: number;
  revenuePerDayCents: number | null;
  jobsPerDay: number | null;
  onJobHours: number;
  revenuePerHourCents: number | null;
  medianInstallMinutes: number | null;
  medianServiceMinutes: number | null;
  utilizationPct: number | null;
  driveMinutes: number;
  drivePerJobMinutes: number | null;
  driveSharePct: number | null;
  miles: number | null;
  milesPerJob: number | null;
  onTimePct: number | null;
  lateStarts: number;
  itemsPerJob: number | null;
  addOnRatePct: number | null;
  repairAvgTicketCents: number | null;
  goBacks: number;
  goBackRatePct: number | null;
  estimates: number;
  estimatesWon: number;
  closeRatePct: number | null;
  estimateWonCents: number;
  estimatePresentedCents: number;
  avgOptions: number | null;
  outstandingCents: number;
  ranks: Record<string, Rank>;
};
type Group = { key: string; jobs: number; revenueCents: number };
type Report = {
  range: { from: string; to: string; label: string; previousLabel: string | null };
  tiles: Tiles;
  previous: Tiles | null;
  trend: { key: string; label: string; revenueCents: number; jobs: number; avgTicketCents: number | null }[];
  trendBy: "week" | "month";
  mix: { byKind: Group[]; byBusinessUnit: Group[]; byJobType: Group[]; afterHours: { jobs: number; revenueCents: number; avgTicketCents: number | null } };
  techs: Tech[];
  medians: Record<string, number | null>;
  products: { name: string; jobs: number; quantity: number; revenueCents: number }[];
  productMatrix: { products: string[]; rows: { tech: string; counts: number[] }[] };
  goBacks: { number: string; firstNumber: string; techs: string[]; days: number; date: string }[];
  lateStarts: { number: string; tech: string; minutesLate: number; date: string }[];
  byZip: { zip: string; jobs: number; revenueCents: number }[];
  dataNotes: string[];
};

// ---- formatting ----
const usd = (cents: number | null | undefined, exact = false) =>
  cents == null ? "–" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: exact ? 2 : 0 });
const pctText = (v: number | null | undefined) => (v == null ? "–" : `${v}%`);
const num = (v: number | null | undefined, unit = "") => (v == null ? "–" : `${v}${unit}`);
const minutesText = (m: number | null | undefined) => (m == null ? "–" : m < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`);
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtDay = (ymd: string) => dayFmt.format(new Date(`${ymd}T00:00:00Z`));

/** Change vs the previous period, as text with an arrow (never color alone). */
function Delta({ now, before, lowerIsBetter = false, money = false }: { now: number | null; before: number | null | undefined; lowerIsBetter?: boolean; money?: boolean }) {
  if (now == null || before == null) return null;
  if (before === 0 && now === 0) return null;
  const diff = now - before;
  const rel = before !== 0 ? Math.round((diff / Math.abs(before)) * 100) : null;
  const up = diff > 0;
  const good = diff === 0 ? null : lowerIsBetter ? !up : up;
  const text = money ? `${up ? "+" : diff < 0 ? "−" : ""}${usd(Math.abs(diff))}` : rel !== null ? `${up ? "+" : diff < 0 ? "−" : ""}${Math.abs(rel)}%` : "";
  return (
    <span data-field="delta" className={`text-[11px] font-bold ${good === null ? "text-brand-gray" : good ? "text-green-800" : "text-red-800"}`}>
      {diff === 0 ? "● no change" : `${up ? "▲" : "▼"} ${text}`}
    </span>
  );
}

function Tile({ label, value, delta, hint }: { label: string; value: string; delta?: React.ReactNode; hint?: string }) {
  return (
    <div data-tile={label} className="flex flex-col gap-0.5 rounded-lg border border-black/10 bg-white p-3" title={hint}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-brand-gray">{label}</p>
      <p className="text-xl font-black text-brand-black">{value}</p>
      {delta}
    </div>
  );
}

/** One-series horizontal bars (brand orange). Labels and values are in ink; hover shows the exact value. */
function Bars({ rows, format, caption }: { rows: { label: string; value: number | null; note?: string }[]; format: (v: number) => string; caption: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <figure className="flex flex-col gap-1.5" aria-label={caption}>
      {rows.map((r) => (
        <div key={r.label} data-bar={r.label} className="grid grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-2" title={`${r.label}: ${r.value == null ? "no data" : format(r.value)}${r.note ? ` (${r.note})` : ""}`}>
          <span className="truncate text-xs font-semibold text-brand-black">{r.label}</span>
          <span className="h-4 rounded-r bg-black/5">
            {r.value != null && r.value > 0 && <span className="block h-4 rounded-r-[4px] bg-brand-orange" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />}
          </span>
          <span className="whitespace-nowrap text-xs font-bold text-brand-black">
            {r.value == null ? "–" : format(r.value)}
            {r.note && <span className="ml-1 font-normal text-brand-gray">{r.note}</span>}
          </span>
        </div>
      ))}
    </figure>
  );
}

/** A table cell carrying the tech's rank against the crew: arrow + tint, so it never relies on color alone. */
function RankCell({ rank, children }: { rank?: Rank; children: React.ReactNode }) {
  const cls = rank === "top" ? "bg-green-50 text-green-900" : rank === "bottom" ? "bg-red-50 text-red-900" : "text-brand-black";
  return (
    <td data-rank={rank ?? "none"} className={`whitespace-nowrap px-2 py-1.5 text-right text-xs font-semibold ${cls}`}>
      {rank === "top" ? "▲ " : rank === "bottom" ? "▼ " : ""}
      {children}
    </td>
  );
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section data-section={id} className="flex flex-col gap-3 border-t border-black/10 pt-6">
      <h2 className="text-base font-black uppercase text-brand-black">{title}</h2>
      {intro && <p className="text-xs text-brand-gray">{intro}</p>}
      {children}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="-mx-6 overflow-x-auto px-6">
      <table className="w-full min-w-max border-collapse text-left">
        <thead>
          <tr className="border-b border-black/10">
            {head.map((h, i) => (
              <th key={h} className={`whitespace-nowrap px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-gray ${i === 0 ? "" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5">{children}</tbody>
      </table>
    </div>
  );
}
const NameCell = ({ t }: { t: { name: string; smallSample?: boolean } }) => (
  <td className="whitespace-nowrap px-2 py-1.5 text-xs font-bold text-brand-black">
    {t.name}
    {t.smallSample && <span className="ml-1 font-normal text-brand-gray">(small sample)</span>}
  </td>
);
const Cell = ({ children }: { children: React.ReactNode }) => <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs text-brand-black">{children}</td>;

export default function ReportsPage() {
  const [state, setState] = useState<"loading" | "signedOut" | "error" | "ready">("loading");
  const [range, setRange] = useState<RangeKey>("30");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (key: RangeKey, fresh: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports?range=${key}${fresh ? "&fresh=1" : ""}`);
      if (res.status === 401 || res.status === 503) {
        setState("signedOut");
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not load reports.");
        setState((s) => (s === "loading" ? "error" : s));
        return;
      }
      setReport(data.report as Report);
      setState("ready");
    } catch {
      setError("Could not reach the server.");
      setState((s) => (s === "loading" ? "error" : s));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the server when the range changes
    void load(range, false);
  }, [range, load]);

  const r = report;
  const ranked = r ? r.techs.filter((t) => t.jobs > 0) : [];
  const p = r?.previous ?? null;

  return (
    <main className="flex min-h-screen flex-col bg-brand-cream">
      <div className="bg-brand-black px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-orange">The Garage Door Guy Corp</p>
          <h1 className="mt-2 text-2xl font-black uppercase leading-tight text-white">Reports</h1>
          <p className="mt-1 text-xs text-white/60">
            <a href="/admin" className="underline hover:text-white">
              &larr; Admin
            </a>
            {r && (
              <span>
                {" "}
                &middot; {r.range.label}: {fmtDay(r.range.from)} &ndash; {fmtDay(r.range.to)}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        {state === "signedOut" && (
          <p data-state="signedOut" className="text-sm text-brand-gray">
            Reports are for admins. Sign in on the <a href="/admin" className="font-bold underline">Admin</a> screen, then come back here.
          </p>
        )}
        {state !== "signedOut" && (
          <div className="mb-6 flex flex-wrap items-center gap-2" data-section="ranges">
            {RANGES.map((x) => (
              <button
                key={x.key}
                type="button"
                data-range={x.key}
                aria-pressed={range === x.key}
                disabled={busy}
                onClick={() => setRange(x.key)}
                className={`rounded-full px-3 py-1 text-xs font-bold disabled:opacity-60 ${range === x.key ? "bg-brand-black text-white" : "bg-white text-brand-gray ring-1 ring-black/10"}`}
              >
                {x.label}
              </button>
            ))}
            <button type="button" data-action="refresh" disabled={busy} onClick={() => void load(range, true)} className="ml-auto text-xs font-bold text-brand-gray underline disabled:opacity-60">
              {busy ? "Reading Housecall Pro…" : "Refresh"}
            </button>
          </div>
        )}
        {state === "loading" && <p className="text-sm text-brand-gray">Reading Housecall Pro&hellip; a whole year can take up to a minute.</p>}
        {error && <p data-state="error" className="mb-4 text-sm font-semibold text-brand-orange-dark">{error}</p>}

        {state === "ready" && r && (
          <div className="flex flex-col gap-8">
            {/* ---- company overview ---- */}
            <section data-section="tiles" className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile label="Revenue" value={usd(r.tiles.revenueCents)} delta={p && <Delta now={r.tiles.revenueCents} before={p.revenueCents} />} />
                <Tile label="Jobs done" value={String(r.tiles.jobs)} delta={p && <Delta now={r.tiles.jobs} before={p.jobs} />} />
                <Tile label="Average ticket" value={usd(r.tiles.avgTicketCents)} delta={p && <Delta now={r.tiles.avgTicketCents} before={p.avgTicketCents} />} />
                <Tile label="Revenue per tech-day" value={usd(r.tiles.revenuePerTechDayCents)} delta={p && <Delta now={r.tiles.revenuePerTechDayCents} before={p.revenuePerTechDayCents} />} />
                <Tile label="Estimate close rate" value={pctText(r.tiles.closeRatePct)} delta={p && <Delta now={r.tiles.closeRatePct} before={p.closeRatePct} />} hint="Estimates with an approved option, or that became a job" />
                <Tile label="Go-back rate" value={pctText(r.tiles.goBackRatePct)} delta={p && <Delta now={r.tiles.goBackRatePct} before={p.goBackRatePct} lowerIsBetter />} hint="Free or warranty/callback return visits within 30 days" />
                <Tile label="Still owed" value={usd(r.tiles.outstandingCents)} delta={p && <Delta now={r.tiles.outstandingCents} before={p.outstandingCents} lowerIsBetter money />} hint="Unpaid balance on finished jobs" />
                <Tile label="After-hours share" value={pctText(r.tiles.afterHoursPct)} hint="Jobs scheduled on weekends or outside 8-5" />
              </div>
              {p && <p className="text-[11px] text-brand-gray">Arrows compare with {r.range.previousLabel}.</p>}
              {r.dataNotes.length > 0 && (
                <ul data-section="notes" className="mt-1 flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                  {r.dataNotes.map((n) => (
                    <li key={n} className="text-[11px] font-semibold text-amber-900">
                      &#9888; {n}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ---- tech scorecard ---- */}
            <Section id="scorecard" title="Tech scorecard" intro="▲ top quarter of the crew, ▼ bottom quarter (techs with 10+ finished jobs). Money on shared jobs is split evenly.">
              {ranked.length === 0 ? (
                <p className="text-sm text-brand-gray">No finished jobs in this range.</p>
              ) : (
                <Table head={["Tech", "Jobs", "Revenue", "$ / day", "$ / hour on job", "Avg ticket", "Close %", "Add-on %", "Go-back %", "On time", "Drive / job"]}>
                  {ranked.map((t) => (
                    <tr key={t.id} data-tech={t.name}>
                      <NameCell t={t} />
                      <Cell>{t.jobs}</Cell>
                      <RankCell rank={t.ranks.revenueCents}>{usd(t.revenueCents)}</RankCell>
                      <RankCell rank={t.ranks.revenuePerDayCents}>{usd(t.revenuePerDayCents)}</RankCell>
                      <RankCell rank={t.ranks.revenuePerHourCents}>{usd(t.revenuePerHourCents)}</RankCell>
                      <RankCell rank={t.ranks.avgTicketCents}>{usd(t.avgTicketCents)}</RankCell>
                      <RankCell rank={t.ranks.closeRatePct}>{pctText(t.closeRatePct)}</RankCell>
                      <RankCell rank={t.ranks.addOnRatePct}>{pctText(t.addOnRatePct)}</RankCell>
                      <RankCell rank={t.ranks.goBackRatePct}>{pctText(t.goBackRatePct)}</RankCell>
                      <RankCell rank={t.ranks.onTimePct}>{pctText(t.onTimePct)}</RankCell>
                      <RankCell rank={t.ranks.drivePerJobMinutes}>{minutesText(t.drivePerJobMinutes)}</RankCell>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>

            <Section id="money" title="Who makes us the most money" intro="Revenue for every hour actually on a job (Start to Finish taps). Total revenue alongside.">
              <Bars
                caption="Revenue per hour on the job, by tech"
                format={(v) => `${usd(v)}/hr`}
                rows={[...ranked].sort((a, b) => (b.revenuePerHourCents ?? -1) - (a.revenuePerHourCents ?? -1)).map((t) => ({ label: t.name, value: t.revenuePerHourCents, note: `${usd(t.revenueCents)} total` }))}
              />
            </Section>

            <Section
              id="sales"
              title="Sellers vs ticket-runners"
              intro="Who sells more than the call: billable items per job and the share of service calls with 2+ billable items. Read it next to go-backs, so overselling doesn't look like selling."
            >
              <Table head={["Tech", "Repair avg ticket", "Items / job", "Add-on %", "Go-back %", "Estimates", "Won $"]}>
                {ranked.map((t) => (
                  <tr key={t.id}>
                    <NameCell t={t} />
                    <Cell>{usd(t.repairAvgTicketCents)}</Cell>
                    <RankCell rank={t.ranks.itemsPerJob}>{num(t.itemsPerJob)}</RankCell>
                    <RankCell rank={t.ranks.addOnRatePct}>{pctText(t.addOnRatePct)}</RankCell>
                    <RankCell rank={t.ranks.goBackRatePct}>{pctText(t.goBackRatePct)}</RankCell>
                    <Cell>{t.estimates}</Cell>
                    <Cell>{usd(t.estimateWonCents)}</Cell>
                  </tr>
                ))}
              </Table>
            </Section>

            <Section id="efficiency" title="Efficiency and time on job" intro="Typical (median) time from Start to Finish, jobs per working day, and how much of the day is spent on jobs (first On my way to last Finish).">
              <Table head={["Tech", "Install time", "Service time", "Jobs / day", "Hours on jobs", "On-job share", "On time"]}>
                {ranked.map((t) => (
                  <tr key={t.id}>
                    <NameCell t={t} />
                    <Cell>{minutesText(t.medianInstallMinutes)}</Cell>
                    <Cell>{minutesText(t.medianServiceMinutes)}</Cell>
                    <RankCell rank={t.ranks.jobsPerDay}>{num(t.jobsPerDay)}</RankCell>
                    <Cell>{num(t.onJobHours, "h")}</Cell>
                    <RankCell rank={t.ranks.utilizationPct}>{pctText(t.utilizationPct)}</RankCell>
                    <RankCell rank={t.ranks.onTimePct}>{pctText(t.onTimePct)}</RankCell>
                  </tr>
                ))}
              </Table>
              {r.lateStarts.length > 0 && (
                <details className="rounded-md border border-black/10 bg-white p-3">
                  <summary className="cursor-pointer text-xs font-bold text-brand-black">Latest starts ({r.lateStarts.length})</summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {r.lateStarts.map((l) => (
                      <li key={`${l.number}-${l.tech}`} className="text-xs text-brand-black">
                        Job #{l.number} &middot; {l.tech} &middot; {fmtDay(l.date)} &middot; started {minutesText(l.minutesLate)} after the scheduled time
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Section>

            <Section id="driving" title="Who drives the most" intro="Drive = On my way to Start taps. Miles are straight-line between his jobs in order, x1.3 for roads: an estimate, not the odometer.">
              <Bars caption="Drive minutes per job, by tech" format={(v) => minutesText(v)} rows={[...ranked].sort((a, b) => (b.drivePerJobMinutes ?? -1) - (a.drivePerJobMinutes ?? -1)).map((t) => ({ label: t.name, value: t.drivePerJobMinutes, note: "per job" }))} />
              <Table head={["Tech", "Drive total", "Drive / job", "Share of day", "Est. miles", "Miles / job"]}>
                {ranked.map((t) => (
                  <tr key={t.id}>
                    <NameCell t={t} />
                    <Cell>{minutesText(t.driveMinutes)}</Cell>
                    <RankCell rank={t.ranks.drivePerJobMinutes}>{minutesText(t.drivePerJobMinutes)}</RankCell>
                    <Cell>{pctText(t.driveSharePct)}</Cell>
                    <Cell>{num(t.miles)}</Cell>
                    <RankCell rank={t.ranks.milesPerJob}>{num(t.milesPerJob)}</RankCell>
                  </tr>
                ))}
              </Table>
            </Section>

            <Section id="products" title="What sells the most" intro="Billable line items, grouped by name. Only as tidy as the price book names.">
              {r.products.length === 0 ? (
                <p className="text-sm text-brand-gray">No line items came with these jobs.</p>
              ) : (
                <>
                  <Bars caption="Top items by revenue" format={(v) => usd(v)} rows={r.products.slice(0, 10).map((x) => ({ label: x.name, value: x.revenueCents, note: `${x.quantity} sold` }))} />
                  <Table head={["Item", "Jobs", "Qty", "Revenue"]}>
                    {r.products.map((x) => (
                      <tr key={x.name}>
                        <td className="px-2 py-1.5 text-xs font-semibold text-brand-black">{x.name}</td>
                        <Cell>{x.jobs}</Cell>
                        <Cell>{x.quantity}</Cell>
                        <Cell>{usd(x.revenueCents)}</Cell>
                      </tr>
                    ))}
                  </Table>
                  {r.productMatrix.products.length > 0 && (
                    <>
                      <h3 className="mt-2 text-xs font-black uppercase text-brand-black">Who sells what (jobs with the item)</h3>
                      <Table head={["Tech", ...r.productMatrix.products]}>
                        {r.productMatrix.rows.map((row) => (
                          <tr key={row.tech}>
                            <td className="whitespace-nowrap px-2 py-1.5 text-xs font-bold text-brand-black">{row.tech}</td>
                            {row.counts.map((c, i) => (
                              <Cell key={i}>{c || "·"}</Cell>
                            ))}
                          </tr>
                        ))}
                      </Table>
                    </>
                  )}
                </>
              )}
            </Section>

            <Section id="gobacks" title="Go-backs" intro="A free return, or a visit tagged callback / warranty / go back, within 30 days of a finished job. Counted against the tech on the first visit. Tagging go-backs in HCP makes this exact.">
              {r.goBacks.length === 0 ? (
                <p className="text-sm text-brand-gray">No go-backs found in this range.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {r.goBacks.map((g) => (
                    <li key={`${g.number}-${g.firstNumber}`} data-goback={g.number} className="rounded-md border border-black/10 bg-white px-3 py-2 text-xs text-brand-black">
                      Job #{g.number} on {fmtDay(g.date)} went back to job #{g.firstNumber} ({g.days} day{g.days === 1 ? "" : "s"} later) &middot; {g.techs.join(", ")}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section id="estimates" title="Estimates by tech" intro="Won = an option approved / pro approved, or a job made from it. Presented $ counts each estimate's highest option.">
              <Table head={["Tech", "Estimates", "Won", "Close %", "Won $", "Presented $", "Options / est."]}>
                {r.techs
                  .filter((t) => t.estimates > 0)
                  .sort((a, b) => b.estimateWonCents - a.estimateWonCents)
                  .map((t) => (
                    <tr key={t.id}>
                      <NameCell t={{ name: t.name }} />
                      <Cell>{t.estimates}</Cell>
                      <Cell>{t.estimatesWon}</Cell>
                      <RankCell rank={t.ranks.closeRatePct}>{pctText(t.closeRatePct)}</RankCell>
                      <Cell>{usd(t.estimateWonCents)}</Cell>
                      <Cell>{usd(t.estimatePresentedCents)}</Cell>
                      <Cell>{num(t.avgOptions)}</Cell>
                    </tr>
                  ))}
              </Table>
            </Section>

            <Section id="owed" title="Still owed, by tech" intro="Unpaid balance on finished jobs in this range (shared jobs split evenly).">
              <Bars caption="Unpaid balance by tech" format={(v) => usd(v)} rows={[...ranked].filter((t) => t.outstandingCents > 0).sort((a, b) => b.outstandingCents - a.outstandingCents).map((t) => ({ label: t.name, value: t.outstandingCents }))} />
              {ranked.every((t) => t.outstandingCents === 0) && <p className="text-sm text-brand-gray">Nothing owed on these jobs.</p>}
            </Section>

            <Section id="trend" title={r.trendBy === "month" ? "Revenue by month" : "Revenue by week"}>
              <Bars caption="Revenue over time" format={(v) => usd(v)} rows={r.trend.map((t) => ({ label: t.label, value: t.revenueCents, note: `${t.jobs} jobs · avg ${usd(t.avgTicketCents)}` }))} />
            </Section>

            <Section id="mix" title="Where the money comes from">
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Installs vs service", r.mix.byKind],
                  ["Business unit", r.mix.byBusinessUnit],
                  ["Job type", r.mix.byJobType],
                  ["Top zip codes", r.byZip.map((z) => ({ key: z.zip, jobs: z.jobs, revenueCents: z.revenueCents }))],
                ].map(([title, groups]) => (
                  <div key={title as string} className="flex flex-col gap-1">
                    <h3 className="text-xs font-black uppercase text-brand-black">{title as string}</h3>
                    <Table head={["", "Jobs", "Revenue"]}>
                      {(groups as Group[]).map((g) => (
                        <tr key={g.key}>
                          <td className="px-2 py-1 text-xs font-semibold text-brand-black">{g.key}</td>
                          <Cell>{g.jobs}</Cell>
                          <Cell>{usd(g.revenueCents)}</Cell>
                        </tr>
                      ))}
                    </Table>
                  </div>
                ))}
              </div>
              <p className="text-xs text-brand-gray">
                After hours (weekends, before 8 or after 5): {r.mix.afterHours.jobs} jobs, {usd(r.mix.afterHours.revenueCents)}, average ticket {usd(r.mix.afterHours.avgTicketCents)}.
              </p>
            </Section>

            <p className="text-[11px] text-brand-gray">Read from Housecall Pro; nothing is changed there. Numbers are cached for ten minutes; Refresh reads them again.</p>
          </div>
        )}
      </div>
    </main>
  );
}
