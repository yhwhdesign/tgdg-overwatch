"use client";

import { useSyncExternalStore } from "react";
import { buildBars, statusLine } from "@/lib/job-watch-view";
import { dismiss, getServerView, getView, subscribe } from "./job-watch-store";

// Job Watch on the website: red bars for a job (or estimate) running over its normal time, green bars for a job a
// tech has just finished (with their notes), and a small status line. Same rules and wording as the desktop panel.
// <JobWatchBars /> goes at the very top of a page; <JobWatchStatus /> goes in the header.

function useWatch() {
  return useSyncExternalStore(subscribe, getView, getServerView);
}

const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function JobWatchBars() {
  const { snapshot, dismissed, now } = useWatch();
  const { shown, more } = buildBars(snapshot.alerts, snapshot.completed, dismissed, now || Date.now());
  if (shown.length === 0) return null;
  return (
    <section data-job-watch="bars" aria-label="Job Watch" className="sticky top-0 z-30 w-full">
      {shown.map((item) => {
        const over = item.type === "over";
        return (
          <div key={item.id} data-bar={item.type} data-bar-id={item.id} role={over ? "alert" : "status"} className={`${over ? "border-b border-[#7a2e07] bg-[#c2410c]" : "border-b border-[#0f3d28] bg-[#1f6f4a]"} px-4 py-3 text-white`}>
            <div className="mx-auto flex max-w-lg flex-col gap-1">
              <p data-field="title" className="text-sm font-bold leading-snug">{item.message.title}</p>
              <p data-field="detail" className="text-xs opacity-90">{item.message.detail}</p>
              {item.type === "done" && (
                <p data-field="notes" className={`mt-1 whitespace-pre-line break-words rounded bg-black/20 px-2 py-1.5 text-xs leading-snug ${item.message.hasNotes ? "" : "italic opacity-85"}`}>{item.message.notes}</p>
              )}
              <div className="mt-1.5 flex gap-2">
                {/* No "Go to job" link: the Housecall Pro phone app can't open web links, so dispatchers look the
                    job or estimate up by the number in the title instead. */}
                <button type="button" data-action="dismiss" onClick={() => dismiss(item.id)} className="rounded border border-white/40 px-3 py-1 text-xs font-bold hover:bg-white/20">
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        );
      })}
      {more > 0 && (
        <div data-field="more" className="bg-[#7a2e07] px-4 py-1 text-center text-xs text-[#ffd9c2]">
          +{more} more (dismiss one to see the next)
        </div>
      )}
    </section>
  );
}

export function JobWatchStatus() {
  const { snapshot } = useWatch();
  if (snapshot.state === "starting") return null;
  const line = statusLine(snapshot, timeLabel);
  const dot = line.tone === "offline" ? "bg-red-500" : line.tone === "trouble" ? "bg-brand-orange" : "bg-green-400";
  return (
    <p data-job-watch="status" data-tone={line.tone} title={line.title} className={`mt-2 flex items-center gap-2 text-xs ${line.tone === "offline" ? "text-orange-200" : "text-white/60"}`}>
      <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span>{line.text}</span>
    </p>
  );
}
