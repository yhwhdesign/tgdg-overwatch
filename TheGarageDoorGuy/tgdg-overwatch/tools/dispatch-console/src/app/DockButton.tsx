"use client";

import { useState, useSyncExternalStore } from "react";
import { DOCK_WINDOW_NAME, dockFeatures, dockGeometry, dockMode, type DockMode } from "@/lib/dock-window";

// A small "Dock" button for the browser. It opens the console in a narrow window against the right edge of the
// screen. (The desktop panel docks for real and keeps itself there; a web page can only place a window it opened.)
const subscribeNothing = () => () => {};
function readMode(): DockMode {
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches === true;
  return dockMode({ userAgent: navigator.userAgent, windowName: window.name, standalone });
}

export default function DockButton() {
  // "hidden" on the server and until the browser takes over, so the page and the browser always agree.
  const mode = useSyncExternalStore(subscribeNothing, readMode, () => "hidden" as DockMode);
  const [note, setNote] = useState<string | null>(null);

  if (mode === "hidden") return null;

  function geometry() {
    return dockGeometry({ availLeft: (window.screen as { availLeft?: number }).availLeft, availTop: (window.screen as { availTop?: number }).availTop, availWidth: window.screen.availWidth, availHeight: window.screen.availHeight });
  }

  function place(target: Window, g: ReturnType<typeof geometry>) {
    try {
      target.resizeTo(g.width, g.height);
      target.moveTo(g.left, g.top);
    } catch {
      /* some browsers refuse; the window still opened where it was asked to */
    }
  }

  function dock() {
    setNote(null);
    const g = geometry();
    if (mode === "redock") {
      place(window, g);
      return;
    }
    const win = window.open(window.location.href, DOCK_WINDOW_NAME, dockFeatures(g));
    if (!win) {
      setNote("Your browser blocked the pop-up. Allow pop-ups for this site, then click Dock again.");
      return;
    }
    place(win, g);
    win.focus?.();
    setNote("Docked in the side window. You can close this tab.");
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={dock}
        title={mode === "redock" ? "Put this window back against the right edge" : "Open the console in a narrow window against the right edge of the screen"}
        className="rounded border border-white/30 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white/80 hover:border-brand-orange hover:text-white"
      >
        {mode === "redock" ? "Re-dock" : "Dock"}
      </button>
      {note && <p role="status" className="mt-1 max-w-[16rem] text-right text-xs text-white/70">{note}</p>}
    </div>
  );
}
