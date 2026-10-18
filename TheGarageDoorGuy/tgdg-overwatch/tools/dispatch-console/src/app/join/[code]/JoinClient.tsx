"use client";

import { useCallback, useEffect, useState } from "react";
import { alreadyOn, detectEnv, turnOff, turnOn, type Phase, type PushDeps } from "@/lib/push-client";

function deps(code: string): PushDeps {
  return { code, fetchImpl: window.fetch.bind(window), notification: window.Notification, serviceWorker: navigator.serviceWorker as unknown as PushDeps["serviceWorker"] };
}

const card = "rounded-2xl bg-white p-6 shadow-sm";
const bigButton = "w-full rounded-xl bg-brand-orange px-5 py-4 text-lg font-black uppercase tracking-wide text-brand-black active:bg-brand-orange-dark disabled:opacity-60";

export default function JoinClient({ code, name }: { code: string; name: string }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const env = detectEnv(window as unknown as Parameters<typeof detectEnv>[0]);
      // On an iPhone, alerts only work from the Home Screen icon, so that comes first.
      if (env.ios && !env.standalone) return live && setPhase(env.safari ? "install" : "open-safari");
      if (!env.supported) return live && setPhase("unsupported");
      if (window.Notification.permission === "denied") return live && setPhase("blocked");
      const on = await alreadyOn(deps(code));
      if (live) setPhase(on ? "on" : "ready");
    })().catch(() => live && setPhase("ready"));
    return () => {
      live = false;
    };
  }, [code]);

  const on = useCallback(async () => {
    setPhase("working");
    setMessage("");
    const result = await turnOn(deps(code));
    if (result.ok) return setPhase("on");
    setMessage(result.message);
    setPhase(result.reason === "denied" ? "blocked" : "error");
  }, [code]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage("Link copied. Open Safari and paste it in the address bar.");
    } catch {
      setMessage("Could not copy. Press and hold the link above, tap Copy, then paste it in Safari.");
    }
  }, []);

  const off = useCallback(async () => {
    setPhase("working");
    await turnOff(deps(code)).catch(() => {});
    setPhase("ready");
  }, [code]);

  return (
    <>
      <header>
        <p className="text-sm font-bold uppercase tracking-widest text-brand-orange-dark">The Garage Door Guy</p>
        <h1 className="mt-1 text-4xl font-black uppercase leading-none tracking-tight text-brand-black">Phone alerts</h1>
        <p className="mt-3 text-base text-brand-gray">For {name}</p>
      </header>

      {phase === "checking" && <div className={card}><p className="text-base text-brand-gray">One moment…</p></div>}

      {phase === "open-safari" && (
        <div className={card} data-phase="open-safari">
          <h2 className="text-xl font-black text-brand-black">Open this page in Safari</h2>
          <p className="mt-2 text-base text-brand-gray">An iPhone only lets Safari add this to the Home Screen, and alerts only work from there. This page is open in a different app or browser.</p>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-base text-brand-black">
            <li>Tap <span className="font-bold">Copy link</span> below.</li>
            <li>Open <span className="font-bold">Safari</span> (the blue compass icon), tap the address bar, paste the link and go.</li>
            <li>Safari then shows how to add it to your Home Screen.</li>
          </ol>
          <p data-field="link" className="mt-4 select-all break-all rounded bg-brand-cream px-3 py-2 font-mono text-xs text-brand-black">{typeof window !== "undefined" ? window.location.href : ""}</p>
          <button type="button" data-action="copy" onClick={() => void copyLink()} className={`${bigButton} mt-4`}>Copy link</button>
          {message && <p role="status" className="mt-3 text-base font-bold text-brand-black">{message}</p>}
          <p className="mt-4 text-sm text-brand-gray">Tip: in many apps the Share or ⋯ menu also has <span className="font-bold">Open in Safari</span>.</p>
        </div>
      )}

      {phase === "install" && (
        <div className={card} data-phase="install">
          <h2 className="text-xl font-black text-brand-black">First, add this page to your Home Screen</h2>
          <p className="mt-2 text-base text-brand-gray">An iPhone only allows alerts from an app on the Home Screen. It takes about 20 seconds:</p>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-base text-brand-black">
            <li>Tap the <span className="font-bold">Share</span> button (the square with an arrow pointing up) at the bottom of Safari.</li>
            <li>Scroll down and tap <span className="font-bold">Add to Home Screen</span>.</li>
            <li>Tap <span className="font-bold">Add</span> in the corner.</li>
            <li>Close Safari and open <span className="font-bold">TGDG Alerts</span> from your Home Screen. It brings you back to this page.</li>
          </ol>
        </div>
      )}

      {phase === "unsupported" && (
        <div className={card} data-phase="unsupported">
          <h2 className="text-xl font-black text-brand-black">This phone can&apos;t get alerts yet</h2>
          <p className="mt-2 text-base text-brand-gray">On an iPhone this needs iOS 16.4 or newer (Settings, General, Software Update). On Android, open this page in Chrome. If it still doesn&apos;t work, tell the office.</p>
        </div>
      )}

      {(phase === "ready" || phase === "working" || phase === "error") && (
        <div className={card} data-phase={phase}>
          <h2 className="text-xl font-black text-brand-black">Turn on alerts</h2>
          <p className="mt-2 text-base text-brand-gray">Tap the button, then tap <span className="font-bold">Allow</span> when your phone asks to send notifications.</p>
          <button type="button" data-action="on" disabled={phase === "working"} onClick={() => void on()} className={`${bigButton} mt-5`}>{phase === "working" ? "Turning on…" : "Turn on alerts"}</button>
          {phase === "error" && message && <p role="alert" className="mt-3 text-base font-bold text-red-700">{message}</p>}
        </div>
      )}

      {phase === "on" && (
        <div className={card} data-phase="on">
          <h2 className="text-xl font-black text-brand-black">Alerts are on</h2>
          <p className="mt-2 text-base text-brand-gray">This phone will get your alerts. You can close this page. Tapping an alert opens the job or estimate in Housecall Pro.</p>
          <button type="button" data-action="off" onClick={() => void off()} className="mt-5 text-sm font-bold uppercase tracking-wide text-brand-gray underline">Turn off alerts on this phone</button>
        </div>
      )}

      {phase === "blocked" && (
        <div className={card} data-phase="blocked">
          <h2 className="text-xl font-black text-brand-black">Alerts are blocked</h2>
          <p className="mt-2 text-base text-brand-gray">This phone said no to notifications. To fix it: open <span className="font-bold">Settings</span>, find <span className="font-bold">TGDG Alerts</span> (or your browser), tap <span className="font-bold">Notifications</span> and allow them. Then come back and tap the button.</p>
          <button type="button" data-action="retry" onClick={() => void on()} className={`${bigButton} mt-5`}>Try again</button>
          {message && <p className="mt-3 text-sm text-brand-gray">{message}</p>}
        </div>
      )}
    </>
  );
}
