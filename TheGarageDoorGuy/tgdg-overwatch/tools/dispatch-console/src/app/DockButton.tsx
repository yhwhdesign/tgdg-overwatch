"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DOCK_WINDOW_NAME, dockFeatures, dockGeometry, dockMode, type DockMode } from "@/lib/dock-window";

// Dock for the browser. A web page cannot move or resize the tab or window it is in (browsers only allow that for a
// window the page itself opened), so Dock opens the console in a narrow window against the right edge and turns THIS
// tab into a "Docked" screen with an Undock button. Undock closes the side window and the console is back here.
// (The desktop panel docks for real and keeps itself there.)

const subscribeNothing = () => () => {};
function readMode(): DockMode {
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches === true;
  return dockMode({ userAgent: navigator.userAgent, windowName: window.name, standalone });
}

function geometry() {
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  return dockGeometry({ availLeft: s.availLeft, availTop: s.availTop, availWidth: s.availWidth, availHeight: s.availHeight });
}

function place(target: Window, g: ReturnType<typeof geometry>) {
  try {
    target.resizeTo(g.width, g.height);
    target.moveTo(g.left, g.top);
  } catch {
    /* some browsers refuse; the window still opened where it was asked to */
  }
}

export default function DockButton() {
  // "hidden" on the server and until the browser takes over, so the page and the browser always agree.
  const mode = useSyncExternalStore(subscribeNothing, readMode, () => "hidden" as DockMode);
  const [note, setNote] = useState<string | null>(null);
  const [docked, setDocked] = useState(false);
  const sideWindow = useRef<Window | null>(null);

  // While docked, notice when the side window is closed (by Undock there, or by its own close button).
  useEffect(() => {
    if (!docked) return;
    const timer = setInterval(() => {
      if (!sideWindow.current || sideWindow.current.closed) {
        sideWindow.current = null;
        setDocked(false);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [docked]);

  if (mode === "hidden") return null;

  function dock() {
    setNote(null);
    const g = geometry();
    const win = window.open(window.location.href, DOCK_WINDOW_NAME, dockFeatures(g));
    if (!win) {
      setNote("Your browser blocked the pop-up. Allow pop-ups for this site, then click Dock again.");
      return;
    }
    place(win, g);
    win.focus?.();
    sideWindow.current = win;
    setDocked(true);
  }

  function undock() {
    sideWindow.current?.close();
    sideWindow.current = null;
    setDocked(false);
  }

  const button = "rounded border border-white/30 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white/80 hover:border-brand-orange hover:text-white";

  if (mode === "redock") {
    // This IS the docked window.
    return (
      <div className="flex gap-2">
        <button type="button" onClick={() => place(window, geometry())} title="Put this window back against the right edge" className={button}>Re-dock</button>
        <button type="button" onClick={() => window.close()} title="Close this window and go back to the tab you docked it from" className={button}>Undock</button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col items-end">
        <button type="button" onClick={dock} title="Open the console in a narrow window against the right edge of the screen" className={button}>Dock</button>
        {note && <p role="status" className="mt-1 max-w-[16rem] text-right text-xs text-white/70">{note}</p>}
      </div>
      {docked && (
        <div data-docked-screen className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-brand-black px-6 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-orange">The Garage Door Guy Corp</p>
          <h2 className="text-2xl font-black uppercase leading-tight text-white">Docked in the side window</h2>
          <p className="max-w-xs text-sm text-white/70">The console is open in the narrow window at the right edge of your screen. Closing that window brings it back here.</p>
          <button type="button" onClick={undock} className="rounded bg-brand-orange px-4 py-2 text-sm font-bold uppercase tracking-wide text-white hover:bg-brand-orange-dark">Undock</button>
        </div>
      )}
    </>
  );
}
