"use client";

import { useEffect, useState } from "react";

type State = "loading" | "signedIn" | "signedOut" | "error";

// Reports from Housecall Pro will live here. For now this is the admin-only home for them: it shows nothing
// to anyone who is not signed in as admin, and says plainly that there is nothing to show yet.
export default function ReportsPage() {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/session");
        if (!res.ok) throw new Error("unavailable");
        const data = (await res.json()) as { signedIn?: boolean };
        if (!cancelled) setState(data.signedIn === true ? "signedIn" : "signedOut");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col bg-brand-cream">
      <div className="bg-brand-black px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-orange">The Garage Door Guy Corp</p>
          <h1 className="mt-2 text-2xl font-black uppercase leading-tight text-white">Reports</h1>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        {state === "loading" && <p className="text-sm text-brand-gray">Loading&hellip;</p>}

        {state === "error" && (
          <p data-state="error" className="text-sm font-semibold text-brand-orange-dark">
            Could not check your sign-in. Make sure the server is running, then reload.
          </p>
        )}

        {state === "signedOut" && (
          <p data-state="signedOut" className="text-sm text-brand-gray">
            Reports are for admins. Sign in on the <span className="font-bold">Admin</span> tab, then come back here.
          </p>
        )}

        {state === "signedIn" && (
          <section data-state="signedIn" className="flex flex-col gap-3">
            <h2 className="text-xl font-black uppercase text-brand-black">Nothing here yet</h2>
            <p className="text-sm text-brand-gray">
              Reporting from Housecall Pro will appear here. This tab only shows while you are signed in as admin.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
