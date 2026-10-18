"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

type Person = { id: string; name: string; topic: string; kinds: string[]; enabled: boolean };
type Kind = { id: string; label: string };
type Loaded = { people: Person[]; kinds: Kind[]; server: string; schedulerReady: boolean };

// Draws a QR code in the browser (nothing is sent anywhere). A phone camera that scans it opens the ntfy app already subscribed.
function Qr({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { margin: 1, width: 176, errorCorrectionLevel: "M" }).then((url) => { if (live) setSrc(url); }).catch(() => { if (live) setSrc(""); });
    return () => { live = false; };
  }, [value]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img data-field="qr" src={src} alt={label} width={176} height={176} className="rounded border border-brand-black/10 bg-white" /> : <div className="h-[176px] w-[176px] rounded bg-brand-cream" />;
}

const JSON_HEADERS = { "content-type": "application/json" };

// Short round buttons, like the R / C / H buttons above; the full wording is the tooltip and the legend.
const CODE: Record<string, string> = { "estimate-finished": "EF", "estimate-waiting": "EW", "job-over": "JO", "job-finished": "JF" };

function Bell({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      {!on && <path d="M3 3l18 18" />}
    </svg>
  );
}

/** Who gets phone notifications, and which kinds each person wants. Sits on the Admin screen. */
export default function NotifyPanel({ techNames, onSignedOut }: { techNames: string[]; onSignedOut: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // the parent passes a fresh function every render; keep the latest in a ref so a re-render never re-fetches the list
  const signedOut = useRef(onSignedOut);
  useEffect(() => {
    signedOut.current = onSignedOut;
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notify");
      if (res.status === 401) return signedOut.current();
      if (!res.ok) throw new Error("Could not load the notification list.");
      const body = (await res.json()) as Partial<Loaded>;
      setData({ people: body.people ?? [], kinds: body.kinds ?? [], server: body.server ?? "https://ntfy.sh", schedulerReady: body.schedulerReady === true });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() only sets state after the fetch finishes
    void load();
  }, [load]);

  async function call(method: string, url: string, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const res = await fetch(url, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
    if (res.status === 401) signedOut.current();
    return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async function save(person: Person, patch: Partial<Pick<Person, "kinds" | "enabled">>) {
    if (!data) return;
    const before = data.people;
    setData({ ...data, people: data.people.map((p) => (p.id === person.id ? { ...p, ...patch } : p)) });
    setNote(null);
    try {
      const r = await call("PUT", "/api/admin/notify", { id: person.id, ...patch });
      if (!r.ok) throw new Error(typeof r.json.error === "string" ? r.json.error : "Could not save.");
    } catch (err) {
      setData((d) => (d ? { ...d, people: before } : d));
      setNote({ ok: false, text: `${person.name}: ${err instanceof Error ? err.message : "could not save."}` });
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await call("POST", "/api/admin/notify", { name });
      if (!r.ok) throw new Error(typeof r.json.error === "string" ? r.json.error : "Could not add.");
      const person = r.json.person as Person;
      setName("");
      setData((d) => (d ? { ...d, people: [...d.people, person] } : d));
      setOpen(person.id);
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Could not add." });
    } finally {
      setBusy(false);
    }
  }

  async function remove(person: Person) {
    if (!window.confirm(`Remove ${person.name} from the notification list?`)) return;
    const r = await call("DELETE", "/api/admin/notify", { id: person.id });
    if (r.ok) setData((d) => (d ? { ...d, people: d.people.filter((p) => p.id !== person.id) } : d));
    else setNote({ ok: false, text: `Could not remove ${person.name}.` });
  }

  async function test(person: Person) {
    setNote(null);
    const r = await call("POST", "/api/admin/notify/test", { id: person.id });
    setNote(r.ok ? { ok: true, text: `Test sent to ${person.name}. It should arrive on the phone within a few seconds.` } : { ok: false, text: typeof r.json.error === "string" ? r.json.error : "The test could not be sent." });
  }

  const taken = new Set((data?.people ?? []).map((p) => p.name.toLowerCase()));
  const suggestions = techNames.filter((n) => !taken.has(n.toLowerCase()));

  return (
    <section className="flex flex-col gap-3" data-section="notify">
      <h2 className="text-xl font-black uppercase text-brand-black">Phone notifications</h2>
      <p className="text-sm text-brand-gray">
        Add the people who should get a notification on their phone, and tap the alerts each one wants. The bell turns a person on or off. Notifications never include a customer&apos;s name, address or a job&apos;s notes; they open the job or estimate in Housecall Pro.
      </p>
      <ul className="flex flex-col gap-1 text-sm text-brand-black">
        {(data?.kinds ?? []).map((k) => (
          <li key={k.id} className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-brand-orange text-[10px] font-black text-brand-orange">{CODE[k.id] ?? "?"}</span>
            <span className="font-bold">{k.label}</span>
          </li>
        ))}
      </ul>

      {data && !data.schedulerReady && (
        <p data-state="no-scheduler" className="text-sm font-semibold text-brand-orange-dark">
          Notifications can only be sent while the server&apos;s scheduler is set up. Set <span className="font-bold">CRON_SECRET</span> on the server and add a scheduled call to <span className="font-bold">/api/cron/notify</span> (the README explains it).
        </p>
      )}
      {error && <p data-state="error" className="text-sm font-semibold text-brand-orange-dark">{error}</p>}
      {note && <p data-state={note.ok ? "note-ok" : "note-error"} className={`text-sm font-semibold ${note.ok ? "text-green-800" : "text-brand-orange-dark"}`}>{note.text}</p>}

      {data && data.people.length === 0 && <p className="text-sm text-brand-gray">Nobody is on the list yet.</p>}
      {data && data.people.length > 0 && (
        <ul className="flex flex-col divide-y divide-brand-black/10 border-t border-brand-black/10" data-section="notify-list">
          {data.people.map((p) => (
            <li key={p.id} data-person={p.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  data-action="bell"
                  aria-pressed={p.enabled}
                  aria-label={`${p.name}: notifications ${p.enabled ? "on" : "off"}`}
                  title={p.enabled ? "Notifications on (tap to turn off)" : "Notifications off (tap to turn on)"}
                  onClick={() => void save(p, { enabled: !p.enabled })}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition ${p.enabled ? "border-brand-orange bg-brand-orange text-brand-black" : "border-brand-black/15 bg-white text-brand-black/50"}`}
                >
                  <Bell on={p.enabled} />
                </button>
                <p className="flex-1 font-semibold text-brand-black">{p.name}</p>
                <div className="flex gap-1.5">
                  {data.kinds.map((k) => {
                    const on = p.kinds.includes(k.id);
                    return (
                      <button
                        key={k.id}
                        type="button"
                        data-kind={k.id}
                        aria-pressed={on}
                        aria-label={`${k.label}: ${on ? "on" : "off"}`}
                        title={k.label}
                        onClick={() => void save(p, { kinds: on ? p.kinds.filter((x) => x !== k.id) : [...p.kinds, k.id] })}
                        className={`h-9 w-9 rounded-full border-2 text-[10px] font-black transition ${on ? "border-brand-orange bg-brand-orange text-brand-black" : "border-brand-black/15 bg-white text-brand-black/60 hover:border-brand-orange"}`}
                      >
                        {CODE[k.id] ?? "?"}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 pl-[52px] text-xs font-bold uppercase tracking-wide">
                <button type="button" data-action="test" onClick={() => void test(p)} className="text-brand-orange-dark hover:underline">Send test</button>
                <button type="button" data-action="setup" onClick={() => setOpen(open === p.id ? null : p.id)} className="text-brand-gray hover:underline">{open === p.id ? "Hide phone setup" : "Phone setup"}</button>
                <button type="button" data-action="remove" onClick={() => void remove(p)} className="text-brand-gray hover:underline">Remove</button>
              </div>
              {open === p.id && (
                <div data-section="setup" className="ml-[52px] rounded-md border border-brand-black/10 bg-white p-3 text-xs text-brand-gray">
                  <p className="font-bold text-brand-black">Set up {p.name}&apos;s phone (once):</p>
                  <ol className="mt-1 list-decimal pl-4">
                    <li>Install the free <span className="font-bold">ntfy</span> app (iPhone or Android) and open it once.</li>
                    <li>Point the phone&apos;s <span className="font-bold">camera</span> at this code and tap the link it shows. The app opens already subscribed.</li>
                  </ol>
                  <div className="mt-2"><Qr value={`ntfy://${data.server.replace(/^https?:\/\//, "")}/${p.topic}`} label={`QR code to subscribe ${p.name}'s phone`} /></div>
                  <p className="mt-2">Camera not working? In the app tap <span className="font-bold">+</span> (subscribe to topic), type this channel name, and tap Subscribe:</p>
                  <p data-field="topic" className="mt-1 select-all break-all rounded bg-brand-cream px-2 py-1 font-mono text-[11px] text-brand-black">{p.topic}</p>
                  <p className="mt-1">
                    Or open <a className="font-bold text-brand-orange-dark underline" href={`${data.server}/${p.topic}`} target="_blank" rel="noopener noreferrer">{data.server}/{p.topic}</a>. Then press <span className="font-bold">Send test</span>. Treat the code and channel name like a password: anyone who has them can read this person&apos;s alerts.
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex gap-2" data-section="notify-add">
        <input
          list="notify-names"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a person (pick from Housecall Pro or type a name)"
          maxLength={60}
          aria-label="Name of the person to add"
          className="min-w-0 flex-1 rounded-md border-2 border-brand-black/10 bg-white px-3 py-2 text-sm font-semibold text-brand-black outline-none focus:border-brand-orange"
        />
        <datalist id="notify-names">{suggestions.map((n) => <option key={n} value={n} />)}</datalist>
        <button type="submit" disabled={busy || !name.trim()} className="rounded-md bg-brand-orange px-4 py-2 text-sm font-bold uppercase tracking-wide text-brand-black hover:bg-brand-orange-dark disabled:opacity-50">Add</button>
      </form>
    </section>
  );
}
