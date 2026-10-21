"use client";

import { useSyncExternalStore } from "react";

// A slim row of links between the console's pages, for people using the website in a browser. The desktop panel has
// its own tabs, so inside the panel (its browser says "Electron") this row is not drawn.
const LINKS = [
  { href: "/", label: "Dispatch" },
  { href: "/estimates", label: "Estimates" },
  { href: "/weekend", label: "Weekend recap" },
];

const subscribeNothing = () => () => {};
const inPanel = () => /Electron/i.test(navigator.userAgent);

export default function SiteNav() {
  const hidden = useSyncExternalStore(subscribeNothing, inPanel, () => true); // hidden on the server, so the page and the browser agree
  const here = useSyncExternalStore(subscribeNothing, () => window.location.pathname.replace(/\/+$/, "") || "/", () => "");
  if (hidden) return null;
  return (
    <nav data-site-nav aria-label="Console pages" className="flex flex-wrap gap-x-5 gap-y-1 border-b border-white/10 bg-brand-black px-6 py-2">
      <div className="mx-auto flex w-full max-w-lg flex-wrap gap-x-5 gap-y-1">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} aria-current={here === l.href ? "page" : undefined} className={`text-xs font-bold uppercase tracking-wide ${here === l.href ? "text-brand-orange" : "text-white/60 hover:text-white"}`}>
            {l.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
