"use client";

import { useCallback, useEffect, useState } from "react";
import { JobWatchBars } from "../JobWatchBars";
import SiteNav from "../SiteNav";
import { MAX_BACK, highlightParts, type RecapItem, type RecapResult } from "@/lib/weekend-recap";

// The Weekend recap: the jobs worked from Friday 6 PM to Sunday 10 PM, with the techs' notes, the ones that look like
// they need the office first. Techs cannot turn a job into an estimate, so whatever else is needed (parts, a return
// visit, a quote) is in the notes, and this page puts them in front of someone on Monday morning.

type Ready = Extract<RecapResult, { ok: true }>;
type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; recap: Ready };

const REVIEWED_KEY = "overwatch.recap.reviewed";
const REVIEWED_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

function loadReviewed(): Record<string, number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REVIEWED_KEY) || "{}");
    const now = Date.now();
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {})) if (typeof v === "number" && now - v < REVIEWED_KEEP_MS && v <= now + 60_000) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function saveReviewed(map: Record<string, number>) {
  try {
    window.localStorage.setItem(REVIEWED_KEY, JSON.stringify(map));
  } catch {
    /* storage blocked: the marks last until the page is closed */
  }
}

const STATE_TEXT: Record<RecapItem["state"], (i: RecapItem) => string> = {
  finished: (i) => `Finished ${i.whenLabel}${i.minutesOnJob != null ? ` after ${i.minutesOnJob < 60 ? `${i.minutesOnJob}m` : `${Math.floor(i.minutesOnJob / 60)}h ${i.minutesOnJob % 60}m`}` : ""}`,
  "in-progress": (i) => `Started ${i.whenLabel}, never finished`,
  "not-started": (i) => `Scheduled ${i.whenLabel}, never started`,
  upcoming: (i) => `Scheduled ${i.whenLabel}`,
};

function Notes({ item, words }: { item: RecapItem; words: string[] }) {
  if (item.notes.length === 0) return null;
  return (
    <div data-field="notes" className="mt-2 space-y-1.5 rounded-md bg-brand-cream px-3 py-2 text-sm leading-snug text-brand-black">
      {item.notes.map((note, n) => (
        <p key={n} className="whitespace-pre-line break-words">
          {highlightParts(note, words).map((part, k) => (part.hit ? <mark key={k} data-hit className="rounded bg-amber-200 px-0.5 font-semibold text-brand-black">{part.text}</mark> : <span key={k}>{part.text}</span>))}
        </p>
      ))}
    </div>
  );
}

function Card({ item, words, reviewed, onToggle, notesHidden }: { item: RecapItem; words: string[]; reviewed: boolean; onToggle: () => void; notesHidden: boolean }) {
  return (
    <li data-item={item.id} data-needs-look={item.needsLook && !reviewed ? "true" : "false"} data-reviewed={reviewed ? "true" : "false"} className={`rounded-lg border bg-white p-4 shadow-sm ${reviewed ? "border-black/10 opacity-60" : item.needsLook ? "border-amber-400" : "border-black/10"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p data-field="label" className="text-sm font-black uppercase leading-tight text-brand-black">{item.label}</p>
          <p data-field="techs" className="text-xs text-brand-gray">{item.techs.join(", ")}</p>
        </div>
        <p data-field="state" className="shrink-0 text-right text-xs font-semibold text-brand-gray">{STATE_TEXT[item.state](item)}</p>
      </div>
      {(item.reasons.length > 0 || notesHidden) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.reasons.includes("words") && <span data-reason="words" className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">May need follow-up: {item.words.join(", ")}</span>}
          {item.reasons.includes("no-notes") && <span data-reason="no-notes" className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-900">No notes left</span>}
          {item.reasons.includes("unfinished") && <span data-reason="unfinished" className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-900">Not finished</span>}
        </div>
      )}
      {notesHidden ? <p data-field="notes-off" className="mt-2 text-xs italic text-brand-gray">Notes are turned off.</p> : <Notes item={item} words={words} />}
      <div className="mt-3 flex gap-2">
        {item.url && (
          <a data-action="go" href={item.url} target="_blank" rel="noopener noreferrer" className="rounded border border-brand-black/40 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-black hover:border-brand-orange hover:text-brand-orange">
            Go to job
          </a>
        )}
        <button type="button" data-action="review" onClick={onToggle} className="rounded border border-brand-black/20 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-gray hover:border-brand-orange hover:text-brand-orange">
          {reviewed ? "Undo reviewed" : "Mark reviewed"}
        </button>
      </div>
    </li>
  );
}

export default function WeekendPage() {
  const [back, setBack] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [filter, setFilter] = useState<"look" | "all">("look");
  const [reviewed, setReviewed] = useState<Record<string, number>>({});

  const load = useCallback(async (which: number, fresh: boolean) => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/weekend-recap?back=${which}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      if (res.redirected || res.status === 401) throw new Error("Sign in again to see the weekend recap.");
      if (!res.ok) throw new Error(`The console answered HTTP ${res.status}.`);
      const body = (await res.json()) as RecapResult;
      setState(body && body.ok === true && Array.isArray(body.items) ? { kind: "ready", recap: body } : { kind: "error", message: body && "error" in body && typeof body.error === "string" ? body.error : "The weekend recap could not be read." });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error && err.message ? err.message : "Can't reach the console." });
    }
  }, []);

  useEffect(() => {
    setReviewed(loadReviewed());
  }, []);
  useEffect(() => {
    void load(back, false);
  }, [back, load]);

  const recap = state.kind === "ready" ? state.recap : null;
  const keyOf = (item: RecapItem) => `${recap?.window.start ?? ""}|${item.id}`;
  const isReviewed = (item: RecapItem) => Object.prototype.hasOwnProperty.call(reviewed, keyOf(item));
  function toggle(item: RecapItem) {
    const next = { ...reviewed };
    if (isReviewed(item)) delete next[keyOf(item)];
    else next[keyOf(item)] = Date.now();
    setReviewed(next);
    saveReviewed(next);
  }

  const items = recap ? recap.items : [];
  const open = items.filter((i) => i.needsLook && !isReviewed(i));
  const shown = recap ? (filter === "look" ? items.filter((i) => i.needsLook) : items) : [];
  // anything already reviewed goes to the bottom, so the top of the list is always what still needs someone
  const ordered = [...shown].sort((a, b) => Number(isReviewed(a)) - Number(isReviewed(b)));

  return (
    <main className="flex min-h-screen flex-col bg-brand-cream">
      <JobWatchBars />
      <SiteNav />
      <div className="bg-brand-black px-6 py-8">
        <div className="mx-auto max-w-lg">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-orange">The Garage Door Guy Corp</p>
          <h1 className="mt-2 text-2xl font-black uppercase leading-tight text-white">Weekend recap</h1>
          {recap && (
            <p data-field="window" className="mt-1 text-sm text-white/70">
              {recap.window.label}
              {recap.window.isCurrent ? " (going on now)" : ""}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" data-action="earlier" disabled={back >= MAX_BACK} onClick={() => setBack(back + 1)} className="rounded border border-white/30 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white/80 hover:border-brand-orange hover:text-white disabled:opacity-40">
              Earlier weekend
            </button>
            <button type="button" data-action="later" disabled={back <= 0} onClick={() => setBack(back - 1)} className="rounded border border-white/30 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white/80 hover:border-brand-orange hover:text-white disabled:opacity-40">
              Later weekend
            </button>
            <button type="button" data-action="refresh" onClick={() => void load(back, true)} className="rounded border border-white/30 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white/80 hover:border-brand-orange hover:text-white">
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-lg px-4 py-6">
        {state.kind === "loading" && <p data-state="loading" role="status" className="text-sm text-brand-gray">Reading the weekend&apos;s jobs&hellip;</p>}
        {state.kind === "error" && (
          <div data-state="error" role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
            <p>{state.message}</p>
            <button type="button" data-action="retry" onClick={() => void load(back, true)} className="mt-2 rounded border border-red-400 px-3 py-1 text-xs font-bold uppercase">
              Try again
            </button>
          </div>
        )}
        {recap && (
          <>
            <p data-field="summary" className="text-sm font-semibold text-brand-black">
              {recap.counts.total === 0
                ? "No jobs were worked this weekend."
                : `${recap.counts.total} ${recap.counts.total === 1 ? "job" : "jobs"} · ${open.length} ${open.length === 1 ? "needs" : "need"} a look${recap.counts.noNotes > 0 ? ` · ${recap.counts.noNotes} with no notes` : ""}`}
            </p>
            {recap.counts.total > 0 && (
              <div role="tablist" aria-label="Which jobs to show" className="mt-3 flex gap-2">
                <button type="button" role="tab" data-filter="look" aria-selected={filter === "look"} onClick={() => setFilter("look")} className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${filter === "look" ? "border-brand-orange bg-brand-orange text-white" : "border-black/20 text-brand-gray"}`}>
                  Needs a look ({recap.counts.needsLook})
                </button>
                <button type="button" role="tab" data-filter="all" aria-selected={filter === "all"} onClick={() => setFilter("all")} className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${filter === "all" ? "border-brand-orange bg-brand-orange text-white" : "border-black/20 text-brand-gray"}`}>
                  Everything ({recap.counts.total})
                </button>
              </div>
            )}
            {recap.counts.total > 0 && ordered.length === 0 && <p data-state="nothing-to-look" className="mt-4 text-sm text-brand-gray">Nothing here needs a look. Choose &ldquo;Everything&rdquo; to read all {recap.counts.total} jobs.</p>}
            <ul className="mt-4 space-y-3">
              {ordered.map((item) => (
                <Card key={item.id} item={item} words={recap.words} reviewed={isReviewed(item)} onToggle={() => toggle(item)} notesHidden={recap.notesHidden} />
              ))}
            </ul>
            {recap.counts.total >= 200 && <p className="mt-3 text-xs text-brand-gray">Showing the first 200 jobs.</p>}
            <details className="mt-6 text-xs text-brand-gray">
              <summary className="cursor-pointer font-semibold">How jobs are flagged</summary>
              <p className="mt-2">A job is flagged when its notes mention one of these words ({recap.words.join(", ")}), when a finished job has no notes at all, or when a job was never finished. A flag is a hint to look, not a verdict. &ldquo;Mark reviewed&rdquo; is saved in this browser only, so each person marks their own.</p>
            </details>
          </>
        )}
      </div>
    </main>
  );
}
