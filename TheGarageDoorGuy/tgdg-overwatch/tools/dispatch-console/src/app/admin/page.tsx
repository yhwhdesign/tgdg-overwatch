"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CLASSIFICATIONS, type Classification } from "@/lib/service-techs";

type Tech = { id: string; name: string; hcpRole: string | null; classification: string | null };
type View = "loading" | "login" | "disabled" | "error" | "list";
type Loaded = { view: View; techs: Tech[]; error: string | null };

const LABEL: Record<Classification, string> = {
  residential: "Residential",
  commercial: "Commercial",
  hybrid: "Hybrid",
};
const LETTER: Record<Classification, string> = { residential: "R", commercial: "C", hybrid: "H" };
const HINT: Record<Classification, string> = {
  residential: "residential calls only",
  commercial: "commercial calls only",
  hybrid: "both residential and commercial calls",
};

const JSON_HEADERS = { "content-type": "application/json" };

async function fetchTechnicians(): Promise<Loaded> {
  try {
    const res = await fetch("/api/admin/technicians");
    if (res.status === 401) return { view: "login", techs: [], error: null };
    if (res.status === 503) return { view: "disabled", techs: [], error: null };
    if (!res.ok) return { view: "error", techs: [], error: "Could not load the technicians." };
    const data = await res.json();
    return { view: "list", techs: data.technicians ?? [], error: null };
  } catch {
    return { view: "error", techs: [], error: "Could not reach the server." };
  }
}

type AdminDetail = {
  part: string;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorDetail: string | null;
  lastTrigger: string | null;
  lastDurationMs: number | null;
};
type AdminStatus = {
  state: "ok" | "stale" | "failing" | "paused" | "unknown";
  message: string;
  timeZone: string;
  refreshRunning: boolean;
  autoSync: { enabled: boolean; everyMinutes: number | null; paused: boolean; nextRunAt: string | null };
  timer: { running: boolean; consecutiveFailures: number; hoursText: string; resumesAt: string } | null;
  timerOffReason: string | null;
  details: AdminDetail[];
};

const PART_LABEL: Record<string, string> = { jobs: "Jobs and appointments", events: "Calendar events" };
const TRIGGER_LABEL: Record<string, string> = { auto: "the automatic refresh", startup: "the server starting up", manual: "a manual refresh" };
const STATE_TONE: Record<AdminStatus["state"], string> = {
  ok: "border-green-600/30 bg-green-50 text-green-900",
  stale: "border-amber-500 bg-amber-50 text-amber-900",
  failing: "border-red-500 bg-red-50 text-red-900",
  paused: "border-brand-black/10 bg-white text-brand-gray",
  unknown: "border-brand-black/10 bg-white text-brand-gray",
};

function ago(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} hr ago` : `${hours} hr ${minutes % 60} min ago`;
}

/** How fresh is the schedule, is the automatic refresh working, and a button to refresh right now. */
function RefreshPanel({ onSignedOut }: { onSignedOut: () => void }) {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => undefined);
  const signedOutRef = useRef(onSignedOut);

  useEffect(() => {
    signedOutRef.current = onSignedOut;
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/sync-status");
        if (res.status === 401) {
          if (!cancelled) signedOutRef.current();
          return;
        }
        if (!res.ok) throw new Error("unavailable");
        const data = (await res.json()) as AdminStatus;
        if (!cancelled) {
          setStatus(data);
          setUnavailable(null);
        }
      } catch {
        if (!cancelled) setUnavailable("The refresh status could not be read.");
      }
    };
    loadRef.current = load;
    const whenVisible = () => {
      if (document.visibilityState !== "hidden") void load();
    };
    void load();
    window.addEventListener("focus", whenVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", whenVisible);
    };
  }, []);

  const clock = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: status?.timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

  async function refreshNow() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/refresh", { method: "POST", headers: JSON_HEADERS, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        signedOutRef.current();
        return;
      }
      if (!res.ok) {
        setResult({ ok: false, text: data.error ?? "The refresh failed." });
      } else {
        let text = `Done in ${data.seconds} seconds: ${data.jobsRows} job rows`;
        text += data.eventsRows === null ? "." : `, ${data.eventsRows} event rows.`;
        if (data.eventsError) text += ` Calendar events could not be refreshed: ${data.eventsError}.`;
        if (data.statusRecorded === false) text += " The refresh worked, but its status could not be saved (has the database migration been run?).";
        setResult({ ok: !data.eventsError, text });
      }
    } catch {
      setResult({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy(false);
      await loadRef.current();
    }
  }

  let timerText = "";
  if (status) {
    if (status.timer && status.autoSync.enabled) {
      timerText = status.autoSync.paused
        ? `Automatic refresh is paused until ${status.timer.resumesAt}.`
        : `Automatic refresh runs about every ${status.autoSync.everyMinutes} minutes, ${status.timer.hoursText}.` +
          (status.autoSync.nextRunAt ? ` Next run at about ${clock(status.autoSync.nextRunAt)}.` : "") +
          (status.timer.running ? " A refresh is running now." : "") +
          (status.timer.consecutiveFailures > 0 ? ` The last ${status.timer.consecutiveFailures} automatic attempt${status.timer.consecutiveFailures === 1 ? "" : "s"} failed.` : "");
    } else {
      timerText = `Automatic refresh is off on this server (${status.timerOffReason ?? "not started"}). The schedule only updates when someone presses Refresh now or runs node scripts/hcp-sync.mjs --write.`;
    }
  }

  return (
    <section data-panel="refresh" className="flex flex-col gap-3">
      <h2 className="text-xl font-black uppercase text-brand-black">Keeping the schedule fresh</h2>
      {!status && unavailable && <p className="text-sm text-brand-gray">{unavailable}</p>}
      {status && (
        <>
          <p data-state={status.state} className={`rounded-md border px-3 py-2 text-sm font-semibold ${STATE_TONE[status.state]}`}>
            {status.message}
          </p>
          <p className="text-sm text-brand-gray">{timerText}</p>
          <ul className="flex flex-col gap-2 text-sm text-brand-black">
            {["jobs", "events"].map((part) => {
              const d = status.details.find((x) => x.part === part);
              const failed = d && d.lastError && (!d.lastSuccessAt || new Date(d.lastAttemptAt) > new Date(d.lastSuccessAt));
              return (
                <li key={part} data-part={part} className="flex flex-col gap-1">
                  <span>
                    <span className="font-bold">{PART_LABEL[part]}:</span>{" "}
                    {d?.lastSuccessAt
                      ? `last refreshed ${clock(d.lastSuccessAt)} (${ago(d.lastSuccessAt)}) by ${TRIGGER_LABEL[d.lastTrigger ?? ""] ?? "an earlier refresh"}${d.lastDurationMs !== null ? `, in ${(d.lastDurationMs / 1000).toFixed(1)} s` : ""}.`
                      : "never refreshed."}
                  </span>
                  {failed && d && (
                    <span className="font-semibold text-brand-orange-dark">
                      The latest attempt ({clock(d.lastAttemptAt)}) failed: {d.lastError}.
                      {d.lastErrorDetail ? <span className="block font-normal text-brand-gray">{d.lastErrorDetail}</span> : null}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <button
        onClick={refreshNow}
        disabled={busy || status?.refreshRunning === true}
        className="self-start rounded-md bg-brand-orange px-4 py-3 text-sm font-bold uppercase tracking-wide text-brand-black transition hover:bg-brand-orange-dark disabled:opacity-50"
      >
        {busy || status?.refreshRunning ? "Refreshing\u2026" : "Refresh now"}
      </button>
      {result && (
        <p role="status" className={`text-sm font-semibold ${result.ok ? "text-brand-black" : "text-brand-orange-dark"}`}>
          {result.text}
        </p>
      )}
    </section>
  );
}

export default function AdminPage() {
  const [view, setView] = useState<View>("loading");
  const [techs, setTechs] = useState<Tech[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function apply(result: Loaded) {
    setView(result.view);
    setTechs(result.techs);
    setLoadError(result.error);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchTechnicians();
      if (!cancelled) apply(result);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoggingIn(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword("");
        apply(await fetchTechnicians());
      } else {
        const data = await res.json().catch(() => ({}));
        setLoginError(data.error ?? "Could not sign in.");
      }
    } catch {
      setLoginError("Could not reach the server.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST", headers: JSON_HEADERS }).catch(() => undefined);
    apply({ view: "login", techs: [], error: null });
  }

  // Clicking the highlighted button again clears the classification (not offered).
  async function setClassification(tech: Tech, clicked: Classification) {
    const next = tech.classification === clicked ? null : clicked;
    const patch = (value: string | null) =>
      setTechs((prev) => prev.map((t) => (t.id === tech.id ? { ...t, classification: value } : t)));

    setSaveError(null);
    patch(next);
    try {
      const res = await fetch("/api/admin/technicians", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ id: tech.id, classification: next }),
      });
      if (res.status === 401) {
        apply({ view: "login", techs: [], error: null });
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not save.");
      }
    } catch (err) {
      patch(tech.classification);
      setSaveError(`${tech.name}: ${err instanceof Error ? err.message : "could not save."}`);
    }
  }

  const sorted = useMemo(() => {
    const isFieldTech = (t: Tech) => (t.hcpRole ?? "").toLowerCase() === "field tech";
    return [...techs].sort(
      (a, b) => Number(!isFieldTech(a)) - Number(!isFieldTech(b)) || a.name.localeCompare(b.name)
    );
  }, [techs]);

  const counts = {
    residential: techs.filter((t) => t.classification === "residential").length,
    commercial: techs.filter((t) => t.classification === "commercial").length,
    hybrid: techs.filter((t) => t.classification === "hybrid").length,
    none: techs.filter((t) => !t.classification).length,
  };

  return (
    <main className="flex min-h-screen flex-col bg-brand-cream">
      <div className="bg-brand-black px-6 py-8">
        <div className="mx-auto flex max-w-2xl items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-brand-orange">
              The Garage Door Guy Corp
            </p>
            <h1 className="mt-2 text-2xl font-black uppercase leading-tight text-white">Admin</h1>
          </div>
          {view === "list" && (
            <button
              onClick={handleLogout}
              className="text-xs font-bold uppercase tracking-wide text-white/60 hover:text-white"
            >
              Sign out
            </button>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        {view === "loading" && <p className="text-sm text-brand-gray">Loading&hellip;</p>}

        {view === "disabled" && (
          <p className="text-sm text-brand-gray">
            Admin is switched off. Set <span className="font-bold">ADMIN_PASSWORD</span> in the server&apos;s
            environment and restart it.
          </p>
        )}

        {view === "error" && <p className="text-sm font-semibold text-brand-orange-dark">{loadError}</p>}

        {view === "login" && (
          <form onSubmit={handleLogin} className="flex max-w-sm flex-col gap-4">
            <label className="text-xs font-bold uppercase tracking-wide text-brand-gray">Admin password</label>
            <input
              type="password"
              autoComplete="current-password"
              className="rounded-md border-2 border-brand-black/10 bg-white px-4 py-3 text-lg font-semibold text-brand-black outline-none focus:border-brand-orange"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
            <button
              type="submit"
              disabled={loggingIn}
              className="rounded-md bg-brand-orange px-4 py-3 text-sm font-bold uppercase tracking-wide text-brand-black transition hover:bg-brand-orange-dark disabled:opacity-50"
            >
              {loggingIn ? "Signing in..." : "Sign in"}
            </button>
            {loginError && <p className="text-sm font-semibold text-brand-orange-dark">{loginError}</p>}
          </form>
        )}

        {view === "list" && (
          <div className="flex flex-col gap-6">
            <RefreshPanel onSignedOut={() => apply({ view: "login", techs: [], error: null })} />
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-black uppercase text-brand-black">Who takes which calls</h2>
              <p className="text-sm text-brand-gray">
                Pick one for each person. Dispatchers only see people who are marked here. Tap the
                highlighted one again to remove someone.
              </p>
              <ul className="flex flex-col gap-1 text-sm text-brand-black">
                {CLASSIFICATIONS.map((c) => (
                  <li key={c} className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-brand-orange text-xs font-black text-brand-orange">
                      {LETTER[c]}
                    </span>
                    <span>
                      <span className="font-bold">{LABEL[c]}</span> &mdash; {HINT[c]}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
                {counts.residential} residential &middot; {counts.commercial} commercial &middot; {counts.hybrid}{" "}
                hybrid &middot; {counts.none} not offered
              </p>
            </section>

            {saveError && <p className="text-sm font-semibold text-brand-orange-dark">{saveError}</p>}

            {sorted.length === 0 ? (
              <p className="text-sm text-brand-gray">
                No technicians yet. They come from Housecall Pro: run{" "}
                <span className="font-bold">node scripts/hcp-sync.mjs --write</span> to load them.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-brand-black/10 border-t border-brand-black/10">
                {sorted.map((t) => (
                  <li key={t.id} className="flex items-center gap-4 py-3">
                    <div className="flex-1">
                      <p className="font-semibold text-brand-black">{t.name}</p>
                      <p className="text-xs text-brand-gray">
                        {t.hcpRole ?? "unknown role"} &middot;{" "}
                        {t.classification
                          ? LABEL[t.classification as Classification] ?? t.classification
                          : "Not offered"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {CLASSIFICATIONS.map((c) => {
                        const selected = t.classification === c;
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setClassification(t, c)}
                            aria-pressed={selected}
                            aria-label={`${LABEL[c]}: ${HINT[c]}`}
                            title={`${LABEL[c]}: ${HINT[c]}`}
                            className={`h-10 w-10 rounded-full border-2 text-sm font-black transition ${
                              selected
                                ? "border-brand-orange bg-brand-orange text-brand-black"
                                : "border-brand-black/15 bg-white text-brand-black/60 hover:border-brand-orange"
                            }`}
                          >
                            {LETTER[c]}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-xs text-brand-gray">
              This list comes from Housecall Pro. To refresh it, run{" "}
              <span className="font-bold">node scripts/hcp-sync.mjs --write</span>. Anyone marked here is
              offered in every zip code.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
