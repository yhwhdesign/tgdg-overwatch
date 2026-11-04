"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { JobWatchBars } from "../JobWatchBars";
import SiteNav from "../SiteNav";
import { reviewLogCsv, type ReviewedRow } from "@/lib/estimates";

type Outcome = "won" | "declined" | "expired" | "open" | "canceled";
type Row = ReviewedRow;
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
  needsReviewCount: number;
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
type ReviewFilter = "needs" | "reviewed" | "all";
const REVIEW_FILTERS: { key: ReviewFilter; label: string }[] = [
  { key: "needs", label: "Needs review" },
  { key: "reviewed", label: "Reviewed" },
  { key: "all", label: "All" },
];
const REVIEWER_KEY = "tgdg.reviewerName";

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

/** Downloads text as a file the browser hands to Google Sheets / Excel (CSV) — no server round-trip. */
function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A printable HTML table of the review log, opened in a new window for Print / Save as PDF. */
function printReviewLog(rows: Row[], listTags: string[], from: string, to: string) {
  const cell = (v: string) => `<td>${v.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>`;
  const body = rows
    .map((r) =>
      `<tr${r.needsReview ? ' class="needs"' : ""}>` +
      cell(r.number || "?") +
      cell(r.createdLabel) +
      cell(r.techs.join(", ")) +
      cell(money(r.amountCents)) +
      cell(OUTCOME_LABEL[r.outcome]) +
      cell(r.reviewed ? (r.changedSinceReview ? "Changed" : "Yes") : "No") +
      cell(r.reviewedBy ?? "") +
      cell(r.reviewedAtLabel ?? "") +
      cell(r.note ?? "") +
      "</tr>"
    )
    .join("");
  const head = ["Estimate #", "Created", "Tech", "Amount", "Outcome", "Reviewed", "By", "When", "Note"].map((h) => `<th>${h}</th>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Estimate review log</title>
<style>
  body{font-family:system-ui,Arial,sans-serif;margin:24px;color:#16140f}
  h1{font-size:18px;margin:0 0 2px}p{margin:0 0 16px;color:#555;font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{background:#16140f;color:#fff;text-align:left;padding:6px 8px}
  td{padding:5px 8px;border-bottom:1px solid #eee;vertical-align:top}
  tr.needs td{background:#fff7ed}
  @media print{@page{margin:12mm}}
</style></head><body>
  <h1>The Garage Door Guy Corp — Estimate review log</h1>
  <p>${listTags.map((t) => `&ldquo;${t}&rdquo;`).join(" + ")} list &middot; ${from} to ${to} &middot; printed ${new Date().toLocaleString("en-US")}</p>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  <script>window.onload=function(){window.print();}</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

export default function EstimatesPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [filter, setFilter] = useState<"all" | Outcome>("all");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("needs");
  // Who is reviewing, remembered on this device (the console login is shared, so names live per device).
  const [reviewer, setReviewer] = useState<string>("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  // Local review state laid over the fetched list, so a mark shows at once without re-reading Housecall Pro.
  const [overrides, setOverrides] = useState<Record<string, Partial<Row>>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = useCallback(async (fresh: boolean) => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(fresh ? "/api/estimates?fresh=1" : "/api/estimates");
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
      setOverrides({});
      setNotes(Object.fromEntries(data.report.list.map((r) => [r.id, r.note ?? ""])));
      setState({ kind: "ready", report: data.report, checkedAt: typeof data.checkedAt === "string" ? data.checkedAt : "" });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error && err.message ? err.message : "Could not reach the server. Make sure it is running, then reload." });
    }
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REVIEWER_KEY);
      if (saved) setReviewer(saved);
    } catch {
      /* private mode / storage blocked: the name just isn't remembered */
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  function saveName(name: string) {
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
    setReviewer(clean);
    setEditingName(false);
    try {
      if (clean) window.localStorage.setItem(REVIEWER_KEY, clean);
    } catch {
      /* ignore */
    }
  }

  // The list with local overrides applied (so a just-reviewed row updates without a full reload).
  const list: Row[] = useMemo(() => {
    if (state.kind !== "ready") return [];
    return state.report.list.map((r) => (overrides[r.id] ? { ...r, ...overrides[r.id] } : r));
  }, [state, overrides]);

  const needsCount = list.filter((r) => r.needsReview).length;

  async function markReviewed(row: Row) {
    if (!reviewer) {
      setEditingName(true);
      setNameDraft("");
      return;
    }
    setBusyId(row.id);
    setRowError((e) => ({ ...e, [row.id]: "" }));
    try {
      const res = await fetch("/api/estimate-reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ estimateId: row.id, reviewedBy: reviewer, note: notes[row.id] ?? "", fingerprint: row.fingerprint }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok !== true) throw new Error(data.error ?? "Could not save the review.");
      const when = new Date();
      setOverrides((o) => ({
        ...o,
        [row.id]: {
          reviewed: true,
          reviewedBy: reviewer,
          reviewedAt: when.toISOString(),
          reviewedAtLabel: `${when.toLocaleString("en-US", { month: "short", day: "numeric" })}, ${when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
          note: (notes[row.id] ?? "").trim() || null,
          changedSinceReview: false,
          needsReview: false,
        },
      }));
    } catch (err) {
      setRowError((e) => ({ ...e, [row.id]: err instanceof Error ? err.message : "Could not save." }));
    } finally {
      setBusyId(null);
    }
  }

  async function clearReview(row: Row) {
    setBusyId(row.id);
    setRowError((e) => ({ ...e, [row.id]: "" }));
    try {
      const res = await fetch(`/api/estimate-reviews?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok !== true) throw new Error(data.error ?? "Could not clear the review.");
      setOverrides((o) => ({ ...o, [row.id]: { reviewed: false, reviewedBy: null, reviewedAt: null, reviewedAtLabel: null, note: null, changedSinceReview: false, needsReview: true } }));
      setNotes((n) => ({ ...n, [row.id]: "" }));
    } catch (err) {
      setRowError((e) => ({ ...e, [row.id]: err instanceof Error ? err.message : "Could not clear." }));
    } finally {
      setBusyId(null);
    }
  }

  const report = state.kind === "ready" ? state.report : null;
  const shown = list.filter((r) => {
    if (filter !== "all" && r.outcome !== filter) return false;
    if (reviewFilter === "needs") return r.needsReview;
    if (reviewFilter === "reviewed") return r.reviewed && !r.changedSinceReview;
    return true;
  });

  function exportCsv() {
    downloadText(`estimate-review-log-${report?.to ?? "export"}.csv`, reviewLogCsv(list), "text/csv;charset=utf-8");
  }

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
            {/* who is reviewing, remembered on this device */}
            <div data-section="reviewer" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2">
              {editingName ? (
                <form
                  className="flex flex-1 flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveName(nameDraft);
                  }}
                >
                  <label htmlFor="reviewer-name" className="text-[11px] font-bold uppercase tracking-wide text-brand-gray">
                    Your name
                  </label>
                  <input
                    id="reviewer-name"
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    placeholder="e.g. Jasen"
                    className="min-w-[8rem] flex-1 rounded border-2 border-black/10 bg-white px-2 py-1 text-sm font-semibold text-brand-black outline-none focus:border-brand-orange"
                  />
                  <button type="submit" className="rounded bg-brand-orange px-2.5 py-1 text-[11px] font-bold text-brand-black">
                    Save
                  </button>
                </form>
              ) : (
                <>
                  <span className="text-[11px] text-brand-gray">
                    Reviewing as <span className="font-bold text-brand-black">{reviewer || "— not set —"}</span>
                  </span>
                  <button
                    type="button"
                    data-action="change-name"
                    onClick={() => {
                      setNameDraft(reviewer);
                      setEditingName(true);
                    }}
                    className="text-[11px] font-bold text-brand-orange-dark underline"
                  >
                    {reviewer ? "Change" : "Set your name"}
                  </button>
                </>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-black uppercase text-brand-black">
                {report.listTags.map((t) => `"${t}"`).join(" + ")} list
              </h2>
              <button type="button" onClick={() => void load(true)} className="rounded border border-black/20 bg-white px-2 py-1 text-[11px] font-bold text-brand-black">
                Refresh
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-section="list-tiles">
              <Tile label="Needs review" value={String(needsCount)} hint="new or changed since looked at" />
              <Tile label="On the list" value={String(report.listTally.total)} />
              <Tile label="Won" value={String(report.listTally.won)} hint={report.listTally.closeRate === null ? undefined : `${report.listTally.closeRate}% close`} />
              <Tile label="Won $" value={money(report.listTally.wonCents)} />
            </div>

            {/* review-status filter (the main one) */}
            <div className="mt-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Review status">
              {REVIEW_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  data-review-filter={f.key}
                  aria-pressed={reviewFilter === f.key}
                  onClick={() => setReviewFilter(f.key)}
                  className={`rounded-full px-3 py-1 text-[11px] font-bold ${reviewFilter === f.key ? "bg-brand-orange text-brand-black" : "border border-black/20 bg-white text-brand-black"}`}
                >
                  {f.label}
                  {f.key === "needs" ? ` (${needsCount})` : ""}
                </button>
              ))}
              <span className="ml-auto flex gap-1.5">
                <button type="button" data-action="export-csv" onClick={exportCsv} className="rounded border border-black/20 bg-white px-2.5 py-1 text-[11px] font-bold text-brand-black">
                  Export CSV
                </button>
                <button type="button" data-action="print" onClick={() => printReviewLog(list, report.listTags, report.from, report.to)} className="rounded border border-black/20 bg-white px-2.5 py-1 text-[11px] font-bold text-brand-black">
                  Print / PDF
                </button>
              </span>
            </div>

            {/* outcome filter (secondary) */}
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Outcome">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  data-filter={f}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${filter === f ? "bg-brand-black text-white" : "border border-black/20 bg-white text-brand-black"}`}
                >
                  {f === "all" ? "All outcomes" : OUTCOME_LABEL[f]}
                </button>
              ))}
            </div>

            <ul className="mt-3 flex flex-col gap-2" data-section="list">
              {shown.length === 0 && (
                <li className="text-sm text-brand-gray">
                  {report.list.length === 0
                    ? "No estimates carry these tags in this period."
                    : reviewFilter === "needs" && needsCount === 0
                      ? "Nothing needs review right now. Nicely done."
                      : "Nothing in this view."}
                </li>
              )}
              {shown.map((r) => (
                <li
                  key={r.id}
                  data-estimate={r.id}
                  data-needs-review={r.needsReview ? "true" : "false"}
                  className={`rounded-lg border bg-white px-3 py-2 ${r.needsReview ? "border-brand-orange" : "border-black/10"}`}
                >
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
                    {r.reviewed && (
                      <span data-field="reviewed-badge" className={`text-[11px] font-bold ${r.changedSinceReview ? "text-brand-orange-dark" : "text-green-800"}`}>
                        {r.changedSinceReview ? "⚠ Changed since reviewed" : `✓ Reviewed by ${r.reviewedBy}`}
                      </span>
                    )}
                  </div>

                  {r.reviewed && (
                    <p className="mt-0.5 text-[11px] text-brand-gray">
                      {r.changedSinceReview ? `Last looked at by ${r.reviewedBy} on ${r.reviewedAtLabel} — it has changed since.` : `on ${r.reviewedAtLabel}`}
                    </p>
                  )}

                  {/* note + actions */}
                  <div className="mt-2 flex flex-col gap-2">
                    <input
                      data-field="note"
                      value={notes[r.id] ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value.slice(0, 500) }))}
                      placeholder="Short note (optional)"
                      className="w-full rounded border border-black/10 bg-white px-2 py-1 text-xs text-brand-black outline-none focus:border-brand-orange"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-action="review"
                        disabled={busyId === r.id}
                        onClick={() => void markReviewed(r)}
                        className={`rounded px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${r.reviewed && !r.changedSinceReview ? "border border-black/20 bg-white text-brand-black" : "bg-brand-orange text-brand-black"}`}
                      >
                        {busyId === r.id ? "Saving…" : r.reviewed && !r.changedSinceReview ? "Update note / re-mark" : r.changedSinceReview ? "Mark reviewed again" : "Mark reviewed"}
                      </button>
                      {r.reviewed && (
                        <button type="button" data-action="unreview" disabled={busyId === r.id} onClick={() => void clearReview(r)} className="text-[11px] font-bold text-brand-gray underline disabled:opacity-50">
                          Clear
                        </button>
                      )}
                    </div>
                    {rowError[r.id] && <p className="text-[11px] font-semibold text-brand-orange-dark">{rowError[r.id]}</p>}
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
              Won = an approved or pro-approved option, or a job was created from it. Close rate leaves canceled estimates out. Reviews are saved here only, never sent to
              Housecall Pro; an estimate that changes after it was reviewed comes back onto Needs review. Numbers are cached for ten minutes; Refresh reads again.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
