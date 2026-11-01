"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Order tracker (Admin only): parts ordered for customers' jobs/estimates and stock for the shop, plus the vendor list
// with links to each vendor's site. Everything is typed in here by hand; nothing is read from or sent to Housecall Pro.

type Status = "to-order" | "ordered" | "shipped" | "arrived" | "done" | "cancelled";
type Kind = "customer" | "stock";
const STATUSES: Status[] = ["to-order", "ordered", "shipped", "arrived", "done", "cancelled"];
const STATUS_LABEL: Record<Status, string> = {
  "to-order": "Needs ordering",
  ordered: "Ordered",
  shipped: "Shipped",
  arrived: "Arrived",
  done: "Done",
  cancelled: "Cancelled",
};
const STATUS_STYLE: Record<Status, string> = {
  "to-order": "bg-amber-100 text-amber-900",
  ordered: "bg-sky-100 text-sky-900",
  shipped: "bg-sky-100 text-sky-900",
  arrived: "bg-green-100 text-green-900",
  done: "bg-black/5 text-brand-gray",
  cancelled: "bg-black/5 text-brand-gray line-through",
};

type Vendor = {
  id: string;
  name: string;
  website: string | null;
  portalUrl: string | null;
  accountNumber: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
};
type Order = {
  id: string;
  kind: Kind;
  status: Status;
  poNumber: string | null;
  vendorId: string | null;
  vendor: { id: string; name: string; portalUrl: string | null; website: string | null } | null;
  jobNumber: string | null;
  estimateNumber: string | null;
  items: string;
  costCents: number | null;
  orderedOn: string | null;
  expectedOn: string | null;
  arrivedOn: string | null;
  trackingNumber: string | null;
  notes: string | null;
  createdAt: string;
};
type Summary = { needsOrdering: number; onTheWay: number; late: number; arrivedNotDone: number; openCostCents: number };
type Data = { today: string; orders: Order[]; summary: Summary; vendors: Vendor[] };

const OPEN: Status[] = ["to-order", "ordered", "shipped"];
const isLate = (o: Order, today: string) => OPEN.includes(o.status) && !!o.expectedOn && o.expectedOn < today;
const money = (cents: number | null) =>
  cents === null ? "" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtDay = (ymd: string | null) => (ymd ? dayFmt.format(new Date(`${ymd}T00:00:00Z`)) : "");

/** What the order form edits: plain strings, so inputs stay controlled. */
type OrderForm = {
  kind: Kind;
  status: Status;
  poNumber: string;
  vendorId: string;
  jobNumber: string;
  estimateNumber: string;
  items: string;
  cost: string;
  orderedOn: string;
  expectedOn: string;
  arrivedOn: string;
  trackingNumber: string;
  notes: string;
};
const EMPTY_ORDER: OrderForm = {
  kind: "customer",
  status: "to-order",
  poNumber: "",
  vendorId: "",
  jobNumber: "",
  estimateNumber: "",
  items: "",
  cost: "",
  orderedOn: "",
  expectedOn: "",
  arrivedOn: "",
  trackingNumber: "",
  notes: "",
};
function formFrom(o: Order): OrderForm {
  return {
    kind: o.kind,
    status: o.status,
    poNumber: o.poNumber ?? "",
    vendorId: o.vendorId ?? "",
    jobNumber: o.jobNumber ?? "",
    estimateNumber: o.estimateNumber ?? "",
    items: o.items,
    cost: o.costCents === null ? "" : (o.costCents / 100).toFixed(2),
    orderedOn: o.orderedOn ?? "",
    expectedOn: o.expectedOn ?? "",
    arrivedOn: o.arrivedOn ?? "",
    trackingNumber: o.trackingNumber ?? "",
    notes: o.notes ?? "",
  };
}
/** Empty strings go to the server as null. */
const orderBody = (f: OrderForm) =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : v]));

type VendorForm = Omit<Vendor, "id" | "active" | "website" | "portalUrl" | "accountNumber" | "contactName" | "phone" | "email" | "notes"> & {
  website: string;
  portalUrl: string;
  accountNumber: string;
  contactName: string;
  phone: string;
  email: string;
  notes: string;
};
const EMPTY_VENDOR: VendorForm = { name: "", website: "", portalUrl: "", accountNumber: "", contactName: "", phone: "", email: "", notes: "" };
const vendorForm = (v: Vendor): VendorForm => ({
  name: v.name,
  website: v.website ?? "",
  portalUrl: v.portalUrl ?? "",
  accountNumber: v.accountNumber ?? "",
  contactName: v.contactName ?? "",
  phone: v.phone ?? "",
  email: v.email ?? "",
  notes: v.notes ?? "",
});

const JSON_HEADERS = { "content-type": "application/json" };
async function send(method: string, url: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method, headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error ?? `Something went wrong (${res.status}).` };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

const inputCls =
  "w-full rounded-md border-2 border-brand-black/10 bg-white px-3 py-2 text-sm text-brand-black outline-none focus:border-brand-orange";
const labelCls = "flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-brand-gray";
const btn = "rounded-md px-3 py-2 text-xs font-bold uppercase tracking-wide";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={labelCls}>
      {label}
      {children}
    </label>
  );
}

function OrderEditor({
  initial,
  vendors,
  onSave,
  onCancel,
  saveLabel,
}: {
  initial: OrderForm;
  vendors: Vendor[];
  onSave: (f: OrderForm) => Promise<string | null>;
  onCancel?: () => void;
  saveLabel: string;
}) {
  const [f, setF] = useState<OrderForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof OrderForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const err = await onSave(f);
    setBusy(false);
    setError(err);
  }
  return (
    <form data-form="order" onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-black/10 bg-white p-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="For">
          <select className={inputCls} value={f.kind} onChange={set("kind")} name="kind">
            <option value="customer">A customer (job / estimate)</option>
            <option value="stock">Shop stock</option>
          </select>
        </Field>
        <Field label="Status">
          <select className={inputCls} value={f.status} onChange={set("status")} name="status">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="What was ordered">
        <textarea className={inputCls} rows={2} value={f.items} onChange={set("items")} name="items" required placeholder="2x 16x7 torsion springs, 207 RW" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vendor">
          <select className={inputCls} value={f.vendorId} onChange={set("vendorId")} name="vendorId">
            <option value="">(none)</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="PO number">
          <input className={inputCls} value={f.poNumber} onChange={set("poNumber")} name="poNumber" />
        </Field>
      </div>
      {f.kind === "customer" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="HCP job #">
            <input className={inputCls} value={f.jobNumber} onChange={set("jobNumber")} name="jobNumber" placeholder="4521" />
          </Field>
          <Field label="HCP estimate #">
            <input className={inputCls} value={f.estimateNumber} onChange={set("estimateNumber")} name="estimateNumber" placeholder="8802" />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Cost ($)">
          <input className={inputCls} value={f.cost} onChange={set("cost")} name="cost" inputMode="decimal" placeholder="125.50" />
        </Field>
        <Field label="Ordered">
          <input className={inputCls} type="date" value={f.orderedOn} onChange={set("orderedOn")} name="orderedOn" />
        </Field>
        <Field label="Expected">
          <input className={inputCls} type="date" value={f.expectedOn} onChange={set("expectedOn")} name="expectedOn" />
        </Field>
        <Field label="Arrived">
          <input className={inputCls} type="date" value={f.arrivedOn} onChange={set("arrivedOn")} name="arrivedOn" />
        </Field>
      </div>
      <Field label="Tracking number">
        <input className={inputCls} value={f.trackingNumber} onChange={set("trackingNumber")} name="trackingNumber" />
      </Field>
      <Field label="Notes">
        <textarea className={inputCls} rows={2} value={f.notes} onChange={set("notes")} name="notes" />
      </Field>
      {error && <p data-field="error" className="text-sm font-semibold text-brand-orange-dark">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={`${btn} bg-brand-orange text-brand-black disabled:opacity-50`}>
          {busy ? "Saving…" : saveLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={`${btn} border border-brand-black/20 text-brand-gray`}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function VendorEditor({
  initial,
  onSave,
  onCancel,
  saveLabel,
}: {
  initial: VendorForm;
  onSave: (f: VendorForm) => Promise<string | null>;
  onCancel?: () => void;
  saveLabel: string;
}) {
  const [f, setF] = useState<VendorForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof VendorForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(await onSave(f));
  }
  return (
    <form data-form="vendor" onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-black/10 bg-white p-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input className={inputCls} value={f.name} onChange={set("name")} name="name" required />
        </Field>
        <Field label="Account #">
          <input className={inputCls} value={f.accountNumber} onChange={set("accountNumber")} name="accountNumber" />
        </Field>
        <Field label="Website">
          <input className={inputCls} value={f.website} onChange={set("website")} name="website" placeholder="supplier.com" />
        </Field>
        <Field label="Order page">
          <input className={inputCls} value={f.portalUrl} onChange={set("portalUrl")} name="portalUrl" placeholder="supplier.com/orders" />
        </Field>
        <Field label="Contact">
          <input className={inputCls} value={f.contactName} onChange={set("contactName")} name="contactName" />
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={f.phone} onChange={set("phone")} name="phone" />
        </Field>
        <Field label="Email">
          <input className={inputCls} value={f.email} onChange={set("email")} name="email" />
        </Field>
      </div>
      <Field label="Notes">
        <textarea className={inputCls} rows={2} value={f.notes} onChange={set("notes")} name="notes" />
      </Field>
      <p className="text-[11px] text-brand-gray">Passwords are never stored here. Keep vendor logins in the vendor&apos;s site or a password manager.</p>
      {error && <p data-field="error" className="text-sm font-semibold text-brand-orange-dark">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={`${btn} bg-brand-orange text-brand-black`}>
          {saveLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={`${btn} border border-brand-black/20 text-brand-gray`}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

type Filter = "open" | "late" | "arrived" | "closed" | "all";
const FILTER_LABEL: Record<Filter, string> = { open: "Open", late: "Late", arrived: "Arrived", closed: "Done / cancelled", all: "All" };

export default function OrdersPage() {
  const [auth, setAuth] = useState<"loading" | "in" | "out" | "error">("loading");
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [addingVendor, setAddingVendor] = useState(false);
  const [editingVendor, setEditingVendor] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/orders");
      if (res.status === 401) {
        setAuth("out");
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        setLoadError(json.error ?? "Could not load orders.");
        return;
      }
      setLoadError(null);
      setData(json as Data);
      setAuth("in");
    } catch {
      setAuth("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the server when the page opens
    void load();
  }, [load]);

  const shown = useMemo(() => {
    if (!data) return [];
    return data.orders.filter((o) =>
      filter === "all"
        ? true
        : filter === "late"
          ? isLate(o, data.today)
          : filter === "open"
            ? OPEN.includes(o.status)
            : filter === "arrived"
              ? o.status === "arrived"
              : o.status === "done" || o.status === "cancelled"
    );
  }, [data, filter]);

  async function saveNew(f: OrderForm) {
    const r = await send("POST", "/api/admin/orders", orderBody(f));
    if (!r.ok) return r.error ?? "Could not save.";
    setAdding(false);
    await load();
    return null;
  }
  async function saveEdit(id: string, f: OrderForm) {
    const r = await send("PUT", `/api/admin/orders/${encodeURIComponent(id)}`, orderBody(f));
    if (!r.ok) return r.error ?? "Could not save.";
    setEditing(null);
    await load();
    return null;
  }
  async function quickStatus(o: Order, status: Status) {
    const r = await send("PUT", `/api/admin/orders/${encodeURIComponent(o.id)}`, orderBody({ ...formFrom(o), status }));
    setRowError((prev) => ({ ...prev, [o.id]: r.ok ? "" : r.error ?? "Could not save." }));
    if (r.ok) await load();
  }
  async function removeOrder(o: Order) {
    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm("Delete this order for good? (Cancelled keeps a record.)")) return;
    const r = await send("DELETE", `/api/admin/orders/${encodeURIComponent(o.id)}`);
    if (r.ok) await load();
    else setRowError((prev) => ({ ...prev, [o.id]: r.error ?? "Could not delete." }));
  }
  async function saveVendor(id: string | null, f: VendorForm) {
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : v]));
    const r = id ? await send("PUT", `/api/admin/vendors/${encodeURIComponent(id)}`, body) : await send("POST", "/api/admin/vendors", body);
    if (!r.ok) return r.error ?? "Could not save.";
    setAddingVendor(false);
    setEditingVendor(null);
    await load();
    return null;
  }
  async function removeVendor(v: Vendor) {
    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(`Remove ${v.name}? Its orders are kept.`)) return;
    const r = await send("DELETE", `/api/admin/vendors/${encodeURIComponent(v.id)}`);
    if (r.ok) await load();
  }

  return (
    <main className="flex min-h-screen flex-col bg-brand-cream">
      <div className="bg-brand-black px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-orange">The Garage Door Guy Corp</p>
          <h1 className="mt-2 text-2xl font-black uppercase leading-tight text-white">Orders</h1>
          <p className="mt-1 text-xs text-white/60">
            <a href="/admin" className="underline hover:text-white">
              &larr; Admin
            </a>
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        {auth === "loading" && <p className="text-sm text-brand-gray">Loading&hellip;</p>}
        {auth === "error" && <p data-state="error" className="text-sm font-semibold text-brand-orange-dark">Could not reach the server. Reload to try again.</p>}
        {auth === "out" && (
          <p data-state="signedOut" className="text-sm text-brand-gray">
            Orders are for admins. Sign in on the <a href="/admin" className="font-bold underline">Admin</a> screen, then come back here.
          </p>
        )}
        {loadError && <p className="text-sm font-semibold text-brand-orange-dark">{loadError}</p>}

        {auth === "in" && data && (
          <div className="flex flex-col gap-8">
            <section data-section="summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Needs ordering", String(data.summary.needsOrdering), "to-order"],
                ["On the way", String(data.summary.onTheWay), "onway"],
                ["Late", String(data.summary.late), "late"],
                ["Arrived, not used", String(data.summary.arrivedNotDone), "arrived"],
              ].map(([label, value, key]) => (
                <div key={key} data-tile={key} className={`rounded-lg border bg-white p-3 ${key === "late" && data.summary.late > 0 ? "border-red-400" : "border-black/10"}`}>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-brand-gray">{label}</p>
                  <p className={`text-2xl font-black ${key === "late" && data.summary.late > 0 ? "text-red-700" : "text-brand-black"}`}>{value}</p>
                </div>
              ))}
              <p className="col-span-2 text-xs text-brand-gray sm:col-span-4">Open orders total {money(data.summary.openCostCents) || "$0.00"}.</p>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-black uppercase text-brand-black">Orders</h2>
                {!adding && (
                  <button type="button" data-action="add-order" onClick={() => setAdding(true)} className={`${btn} bg-brand-orange text-brand-black`}>
                    + New order
                  </button>
                )}
              </div>
              {adding && <OrderEditor initial={EMPTY_ORDER} vendors={data.vendors} onSave={saveNew} onCancel={() => setAdding(false)} saveLabel="Add order" />}
              <div className="flex flex-wrap gap-2" data-section="filters">
                {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    data-filter={f}
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                    className={`rounded-full px-3 py-1 text-xs font-bold ${filter === f ? "bg-brand-black text-white" : "bg-white text-brand-gray ring-1 ring-black/10"}`}
                  >
                    {FILTER_LABEL[f]}
                  </button>
                ))}
              </div>
              <ul className="flex flex-col gap-2" data-section="orders">
                {shown.length === 0 && <li className="text-sm text-brand-gray">{data.orders.length === 0 ? "No orders yet. Add the first one above." : "Nothing in this view."}</li>}
                {shown.map((o) =>
                  editing === o.id ? (
                    <li key={o.id}>
                      <OrderEditor initial={formFrom(o)} vendors={data.vendors} onSave={(f) => saveEdit(o.id, f)} onCancel={() => setEditing(null)} saveLabel="Save" />
                    </li>
                  ) : (
                    <li key={o.id} data-order={o.id} data-late={isLate(o, data.today) ? "true" : "false"} className={`rounded-lg border bg-white p-3 ${isLate(o, data.today) ? "border-red-400" : "border-black/10"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-brand-black">{o.items}</p>
                          <p className="text-[11px] text-brand-gray">
                            {[
                              o.kind === "stock" ? "Shop stock" : null,
                              o.jobNumber ? `Job #${o.jobNumber}` : null,
                              o.estimateNumber ? `Estimate #${o.estimateNumber}` : null,
                              o.vendor?.name ?? null,
                              o.poNumber ? `PO ${o.poNumber}` : null,
                              money(o.costCents) || null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <p className="text-[11px] text-brand-gray">
                            {[
                              o.orderedOn ? `Ordered ${fmtDay(o.orderedOn)}` : null,
                              o.expectedOn ? `Expected ${fmtDay(o.expectedOn)}` : null,
                              o.arrivedOn ? `Arrived ${fmtDay(o.arrivedOn)}` : null,
                              o.trackingNumber ? `Tracking ${o.trackingNumber}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {isLate(o, data.today) && <p data-field="late" className="mt-1 text-xs font-bold text-red-700">Late: expected {fmtDay(o.expectedOn)}</p>}
                          {o.notes && <p className="mt-1 whitespace-pre-line text-xs text-brand-black/80">{o.notes}</p>}
                        </div>
                        <span data-field="status" className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`status-${o.id}`}>Change status</label>
                        <select
                          id={`status-${o.id}`}
                          data-action="status"
                          value={o.status}
                          onChange={(e) => void quickStatus(o, e.target.value as Status)}
                          className="rounded-md border border-black/15 bg-white px-2 py-1 text-xs font-semibold"
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                        {o.vendor?.portalUrl && (
                          <a data-action="vendor-page" href={o.vendor.portalUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-brand-orange-dark underline">
                            {o.vendor.name} order page
                          </a>
                        )}
                        <button type="button" data-action="edit" onClick={() => setEditing(o.id)} className="text-xs font-bold text-brand-gray underline">
                          Edit
                        </button>
                        <button type="button" data-action="delete" onClick={() => void removeOrder(o)} className="text-xs font-bold text-brand-gray underline">
                          Delete
                        </button>
                      </div>
                      {rowError[o.id] && <p className="mt-1 text-xs font-semibold text-brand-orange-dark">{rowError[o.id]}</p>}
                    </li>
                  )
                )}
              </ul>
            </section>

            <section className="flex flex-col gap-3 border-t border-black/10 pt-6" data-section="vendors">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-black uppercase text-brand-black">Vendors</h2>
                {!addingVendor && (
                  <button type="button" data-action="add-vendor" onClick={() => setAddingVendor(true)} className={`${btn} border border-brand-black/20 text-brand-black`}>
                    + Vendor
                  </button>
                )}
              </div>
              {addingVendor && <VendorEditor initial={EMPTY_VENDOR} onSave={(f) => saveVendor(null, f)} onCancel={() => setAddingVendor(false)} saveLabel="Add vendor" />}
              {data.vendors.length === 0 && !addingVendor && <p className="text-sm text-brand-gray">No vendors yet. Add the suppliers you order from, with a link to each one&apos;s order page.</p>}
              <ul className="flex flex-col gap-2">
                {data.vendors.map((v) =>
                  editingVendor === v.id ? (
                    <li key={v.id}>
                      <VendorEditor initial={vendorForm(v)} onSave={(f) => saveVendor(v.id, f)} onCancel={() => setEditingVendor(null)} saveLabel="Save" />
                    </li>
                  ) : (
                    <li key={v.id} data-vendor={v.id} className="rounded-lg border border-black/10 bg-white p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-black text-brand-black">{v.name}</p>
                        <p className="text-[11px] text-brand-gray">
                          {[v.accountNumber ? `Acct ${v.accountNumber}` : null, v.contactName, v.phone, v.email].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {v.notes && <p className="mt-1 text-xs text-brand-black/80">{v.notes}</p>}
                      <div className="mt-2 flex flex-wrap gap-3">
                        {v.portalUrl && (
                          <a data-action="portal" href={v.portalUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-brand-orange-dark underline">
                            Order page
                          </a>
                        )}
                        {v.website && (
                          <a data-action="website" href={v.website} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-brand-orange-dark underline">
                            Website
                          </a>
                        )}
                        <button type="button" onClick={() => setEditingVendor(v.id)} className="text-xs font-bold text-brand-gray underline">
                          Edit
                        </button>
                        <button type="button" onClick={() => void removeVendor(v)} className="text-xs font-bold text-brand-gray underline">
                          Remove
                        </button>
                      </div>
                    </li>
                  )
                )}
              </ul>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
