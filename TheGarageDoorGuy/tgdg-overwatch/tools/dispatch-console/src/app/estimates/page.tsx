"use client";

import { useCallback, useEffect, useState } from "react";
import { JobWatchBars } from "../JobWatchBars";
import SiteNav from "../SiteNav";

type Outcome = "won" | "declined" | "expired" | "open" | "canceled";
interface Row {
  id: string;
  number: string;
  createdLabel: string;
  techs: string[];
  outcome: Outcome;
  amountCents: number;
  suspect: boolean;
  options: number;
  customer: string | null;
  url: string | null;
}
interface Tally {
  total: number;
  won: number;
  declined: number;
  expired: number;
  open: number;
  canceled: number;
  closeRate: number | null;
  wonCents: number;
}
interface Report {
  from: string;
  to: string;
  listTags: string[];
  list: Row[];
  listTally: Tally;
  byMonth: { key: string; tally: Tally }[];
  byTech: { key: string; tally: Tally }[];
  allTally: Tally;
}
type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; report: Report; checkedAt: string };

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const OUTCOME_LABEL: Record<Outcome, string> = { won: "Won", open: "Waiting", declined: "Declined", expired: "Expired", canceled: "Canceled" };
const OUTCOME_STYLE: Record<Outcome, string> = {
  won: "bg-green-100 text-green-800",
  open: "bg-orange-100 text-brand-orange-dark",
  declined: "bg-red-100 text-red-800",
  expired: "bg-stone-200 text-stone-700",
  canceled: "bg-stone-200 text-stone-700",
};
const FILTERS: ("all" | Outcome)[] = ["all", "open", "won", "declined", "expired", "canceled"];

function isReport(value: unknown): value is Report {
  const r = value as Report | null;
  return !!r && typeof r === "object" && Array.isArray(r.list) && Array.isArray(r.byMonth) && Array.isArray(r.byTech) && !!r.listTally && !!r.allTally;
}

function monthName(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-brand-gray">{label}</p>
      <p className="text-lg font-black text-brand-black">{value}</p>
      {hint ? <p className="text-[10px] text-brand-gray">{hint}</p> : null}
    </div>
  );
}

function TallyRows({ title, rows }: { title: string; rows: { key: string; label: string; tally: Tally }[] }) {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-black uppercase text-brand-black">{title}</h3>
      <div className="mt-2 overflow-x-auto rounded-lg border border-black/10 bg-white">
        <table className="w-full min-w-[320px] text-left text-xs">
          <thead className="bg-brand-black text-white">
            <tr>
              <th className="px-2 py-1.5 font-bold">&nbsp;</th>
              <th className="px-2 py-1.5 font-bold">Made</th>
              <th className="px-2 py-1.5 font-bold">Won</th>
              <th className="px-2 py-1.5 font-bold">Close</th>
              <th className="px-2 py-1.5 font-bold">Won $</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-black/5">
                <td className="px-2 py-1.5 font-semibold">{r.label}</td>
                <td className="px-2 py-1.5">{r.tally.total}</td>
                <td className="px-2 py-1.5">{r.tally.won}</td>
                <td className="px-2 py-1.5">{r.tally.closeRate === null ? "-" : `${r.tally.closeRate}%`}</td>
                <td className="px-2 py-1.5">{money(r.tally.wonCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function EstimatesPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [filter, setFilter] = useState<"all" | Outcome>("all");

  const load = useCallback(async (fresh: boolean) => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(fresh ? "/api/estimates?fresh=1" : "/api/estimates");
      // A sign-in page or a "timed out" page is not JSON: say what happened instead of showing the browser's parsing error.
      if (res.redirected || res.status === 401) throw new Error("Sign in again to see the estimates.");
      if (res.status === 408 || res.status === 504) throw new Error("Housecall Pro took too long to answer. Try again in a minute.");
      let data: { ok?: boolean; error?: string; checkedAt?: string; report?: unknown };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        throw new Error(`The server sent something unexpected (HTTP ${res.status}). Try again in a minute.`);
      }
      if (!res.ok || data.ok !== true) throw new Error(typeof data.error === "string" ? data.error : "The server could not read estimates.");
      if (!isReport(data.report)) throw new Error("The server's answer was not what was expected.");
      setState({ kind: "ready", report: data.report, checkedAt: typeof data.checkedAt === "string" ? data.checkedAt : "" });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error && err.message ? err.message : "Could not reach the server. Make sure it is running, then reload." });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets "loading" first, then the fetched result
    void load(false);
  }, [load]);

  const report = state.kind === "ready" ? state.report : null;
  const shown = report ? report.list.filter((r) => filter === "all" || r.outcome === filter) : [];

  return (
    <main className="flex min-h-screen flex-col bg-brand-cream">
      <JobWatchBars />
      <SiteNav />
      <div className="bg-brand-black px-4 py-6">
        <div className="mx-auto max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-orange">The Garage Door Guy Corp</p>
          <h1 className="mt-2 text-2xl font-black uppercase leading-tight text-white">Estimates</h1>
          {report ? (
            <p className="mt-1 text-xs text-white/70">
              {report.from} to {report.to}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-5">
        {state.kind === "loading" && <p data-state="loading" className="text-sm text-brand-gray">Loading estimates&hellip; this reads the whole year, so the first time can take a little while.</p>}

        {state.kind === "error" && (
          <div data-state="error">
            <p className="text-sm font-semibold text-brand-orange-dark">{state.message}</p>
            <button type="button" onClick={() => void load(true)} className="mt-3 rounded bg-brand-black px-3 py-1.5 text-xs font-bold text-white">
              Try again
            </button>
          </div>
        )}

        {report && state.kind === "ready" && (
          <div data-state="ready">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-black uppercase text-brand-black">
                {report.listTags.map((t) => `"${t}"`).join(" + ")} list
              </h2>
              <button type="button" onClick={() => void load(true)} className="rounded border border-black/20 bg-white px-2 py-1 text-[11px] font-bold text-brand-black">
                Refresh
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-section="list-tiles">
              <Tile label="On the list" value={String(report.listTally.total)} />
              <Tile label="Waiting" value={String(report.listTally.open)} />
              <Tile label="Won" value={String(report.listTally.won)} hint={report.listTally.closeRate === null ? undefined : `${report.listTally.closeRate}% close`} />
              <Tile label="Won $" value={money(report.listTally.wonCents)} />
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Show">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  data-filter={f}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${filter === f ? "bg-brand-black text-white" : "border border-black/20 bg-white text-brand-black"}`}
                >
                  {f === "all" ? "All" : OUTCOME_LABEL[f]}
                </button>
              ))}
            </div>

            <ul className="mt-3 flex flex-col gap-2" data-section="list">
              {shown.length === 0 && <li className="text-sm text-brand-gray">{report.list.length === 0 ? "No estimates carry these tags in this period." : "Nothing in this view."}</li>}
              {shown.map((r) => (
                <li key={r.id} data-estimate={r.id} className="rounded-lg border border-black/10 bg-white px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-black text-brand-black">
                        Estimate #{r.number || "?"}
                        {r.customer ? <span className="font-semibold"> &middot; {r.customer}</span> : null}
                      </p>
                      <p className="text-[11px] text-brand-gray">
                        {r.createdLabel}
                        {r.techs.length ? ` · ${r.techs.join(", ")}` : ""}
                        {` · ${r.options} option${r.options === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${OUTCOME_STYLE[r.outcome]}`}>{OUTCOME_LABEL[r.outcome]}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <p className="text-sm font-bold text-brand-black">
                      {money(r.amountCents)}
                      {r.suspect ? <span className="ml-1 text-[10px] font-bold text-brand-orange-dark">(check this amount)</span> : null}
                    </p>
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="rounded bg-brand-orange px-2.5 py-1 text-[11px] font-bold text-white">
                        Go to estimate
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            <h2 className="mt-8 text-base font-black uppercase text-brand-black">All estimates this year</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-section="all-tiles">
              <Tile label="Made" value={String(report.allTally.total)} />
              <Tile label="Close rate" value={report.allTally.closeRate === null ? "-" : `${report.allTally.closeRate}%`} hint="won / all but canceled" />
              <Tile label="Won" value={String(report.allTally.won)} />
              <Tile label="Won $" value={money(report.allTally.wonCents)} />
            </div>
            <TallyRows title="By month" rows={report.byMonth.map((m) => ({ key: m.key, label: monthName(m.key), tally: m.tally }))} />
            <TallyRows title="By tech" rows={report.byTech.map((t) => ({ key: t.key, label: t.key, tally: t.tally }))} />
            <p className="mt-6 text-[11px] text-brand-gray">
              Won = an approved or pro-approved option, or a job was created from it. Close rate leaves canceled estimates out. Numbers are cached for ten minutes; Refresh reads again.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
