"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/console/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.ok) {
        const next = new URLSearchParams(window.location.search).get("next");
        // Only go to a page on this site.
        window.location.assign(next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") && !next.startsWith("/login") ? next : "/");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not sign in.");
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-brand-black/10 bg-white p-6 shadow-sm">
        <p className="text-xs font-extrabold uppercase tracking-widest text-brand-orange">The Garage Door Guy Corp</p>
        <h1 className="mt-1 text-2xl font-black text-brand-black">Dispatch Console</h1>
        <p className="mt-2 text-sm text-brand-gray">Sign in to see the schedule.</p>
        <label htmlFor="password" className="mt-5 block text-sm font-semibold text-brand-black">Password</label>
        <input
          id="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-brand-black/20 px-3 py-2 text-base text-brand-black outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/30"
        />
        {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-5 w-full rounded-lg bg-brand-orange px-4 py-2.5 font-bold text-white hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
