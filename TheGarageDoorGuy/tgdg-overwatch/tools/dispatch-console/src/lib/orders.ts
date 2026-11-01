// Order tracker: the rules. Pure functions (no database, no network) so they can be tested directly.
//
// Orders and vendors are typed in by hand on the Admin side. Nothing here reads from or writes to Housecall Pro;
// a job or estimate is referred to by the NUMBER people type into HCP. Vendor logins/passwords are never stored.

export const ORDER_STATUSES = ["to-order", "ordered", "shipped", "arrived", "done", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_KINDS = ["customer", "stock"] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

/** Statuses where the order is still on its way (and can therefore be late). */
export const OPEN_STATUSES: OrderStatus[] = ["to-order", "ordered", "shipped"];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  "to-order": "Needs ordering",
  ordered: "Ordered",
  shipped: "Shipped",
  arrived: "Arrived",
  done: "Done (installed / used)",
  cancelled: "Cancelled",
};

export interface OrderInput {
  kind: OrderKind;
  status: OrderStatus;
  poNumber: string | null;
  vendorId: string | null;
  jobNumber: string | null;
  estimateNumber: string | null;
  items: string;
  costCents: number | null;
  orderedOn: string | null;
  expectedOn: string | null;
  arrivedOn: string | null;
  trackingNumber: string | null;
  notes: string | null;
}

export interface VendorInput {
  name: string;
  website: string | null;
  portalUrl: string | null;
  accountNumber: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

type Body = Record<string, unknown>;

/** Trimmed text, null when empty. Over `max` characters is an error (never silently cut). */
function text(body: Body, key: string, max: number, label: string): { v: string | null } | { error: string } {
  const raw = body[key];
  if (raw === undefined || raw === null) return { v: null };
  if (typeof raw !== "string") return { error: `${label} must be text.` };
  const t = raw.trim();
  if (t.length > max) return { error: `${label} is too long (${max} characters at most).` };
  return { v: t === "" ? null : t };
}

/** A real calendar date written YYYY-MM-DD, or null. */
export function validDate(value: string | null): boolean {
  if (value === null) return true;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Only real web addresses (https or http), so a saved link can never run code when clicked. */
export function safeLink(value: string | null): string | null {
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password || !u.hostname.includes(".")) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** "$1,234.56", "1234.5", "1,234" -> cents. Null when empty. */
export function parseMoney(raw: unknown): { v: number | null } | { error: string } {
  if (raw === undefined || raw === null || raw === "") return { v: null };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0 || raw > 10_000_000) return { error: "Cost must be a dollar amount." };
    return { v: Math.round(raw * 100) };
  }
  if (typeof raw !== "string") return { error: "Cost must be a dollar amount." };
  const t = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: "Cost must be a dollar amount, like 125.50." };
  const dollars = Number(t);
  if (dollars > 10_000_000) return { error: "Cost looks too large." };
  return { v: Math.round(dollars * 100) };
}

/** Checks everything an order form can send. Unknown fields are ignored. */
export function parseOrderInput(input: unknown): Parsed<OrderInput> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Send the order as JSON." };
  const b = input as Body;
  const kind = b.kind === undefined ? "customer" : b.kind;
  if (!ORDER_KINDS.includes(kind as OrderKind)) return { ok: false, error: 'kind must be "customer" or "stock".' };
  const status = b.status === undefined ? "to-order" : b.status;
  if (!ORDER_STATUSES.includes(status as OrderStatus)) return { ok: false, error: `status must be one of: ${ORDER_STATUSES.join(", ")}.` };

  const fields: [keyof OrderInput, number, string][] = [
    ["poNumber", 60, "PO number"],
    ["vendorId", 60, "Vendor"],
    ["jobNumber", 30, "Job number"],
    ["estimateNumber", 30, "Estimate number"],
    ["items", 1000, "What was ordered"],
    ["orderedOn", 10, "Ordered date"],
    ["expectedOn", 10, "Expected date"],
    ["arrivedOn", 10, "Arrived date"],
    ["trackingNumber", 80, "Tracking number"],
    ["notes", 2000, "Notes"],
  ];
  const out: Record<string, string | null> = {};
  for (const [key, max, label] of fields) {
    const r = text(b, key, max, label);
    if ("error" in r) return { ok: false, error: r.error };
    out[key] = r.v;
  }
  // People type "#4521"; keep just the number part so it matches what HCP shows.
  for (const key of ["jobNumber", "estimateNumber"]) if (out[key]) out[key] = (out[key] as string).replace(/^#\s*/, "");
  if (!out.items) return { ok: false, error: "Say what was ordered." };
  for (const [key, label] of [["orderedOn", "Ordered date"], ["expectedOn", "Expected date"], ["arrivedOn", "Arrived date"]] as const) {
    if (!validDate(out[key])) return { ok: false, error: `${label} must be a real date (YYYY-MM-DD).` };
  }
  // The form sends dollars as `cost` ("125.50"); the database keeps cents.
  const cost = parseMoney(b.cost);
  if ("error" in cost) return { ok: false, error: cost.error };

  return {
    ok: true,
    value: {
      kind: kind as OrderKind,
      status: status as OrderStatus,
      poNumber: out.poNumber,
      vendorId: out.vendorId,
      jobNumber: out.jobNumber,
      estimateNumber: out.estimateNumber,
      items: out.items,
      costCents: cost.v,
      orderedOn: out.orderedOn,
      expectedOn: out.expectedOn,
      arrivedOn: out.arrivedOn,
      trackingNumber: out.trackingNumber,
      notes: out.notes,
    },
  };
}

/** Checks everything a vendor form can send. */
export function parseVendorInput(input: unknown): Parsed<VendorInput> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Send the vendor as JSON." };
  const b = input as Body;
  // Never accept anything that looks like a password field: logins stay in the vendor's own site / a password manager.
  if (Object.keys(b).some((k) => /pass(word)?|pwd|secret/i.test(k))) return { ok: false, error: "Vendor passwords are never stored here." };
  const fields: [keyof VendorInput, number, string][] = [
    ["name", 80, "Name"],
    ["website", 300, "Website"],
    ["portalUrl", 300, "Order page"],
    ["accountNumber", 60, "Account number"],
    ["contactName", 80, "Contact"],
    ["phone", 40, "Phone"],
    ["email", 120, "Email"],
    ["notes", 2000, "Notes"],
  ];
  const out: Record<string, string | null> = {};
  for (const [key, max, label] of fields) {
    const r = text(b, key, max, label);
    if ("error" in r) return { ok: false, error: r.error };
    out[key] = r.v;
  }
  if (!out.name) return { ok: false, error: "The vendor needs a name." };
  for (const [key, label] of [["website", "Website"], ["portalUrl", "Order page"]] as const) {
    if (out[key]) {
      const link = safeLink(out[key]);
      if (!link) return { ok: false, error: `${label} must be a web address, like supplier.com.` };
      out[key] = link;
    }
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) return { ok: false, error: "Email doesn't look right." };
  if (b.active !== undefined && typeof b.active !== "boolean") return { ok: false, error: "active must be true or false." };
  return {
    ok: true,
    value: {
      name: out.name,
      website: out.website,
      portalUrl: out.portalUrl,
      accountNumber: out.accountNumber,
      contactName: out.contactName,
      phone: out.phone,
      email: out.email,
      notes: out.notes,
      active: b.active === undefined ? true : (b.active as boolean),
    },
  };
}

/** Moving to "arrived" with no arrived date fills in today; moving to "ordered" with no ordered date does the same. */
export function fillStatusDates(order: OrderInput, today: string): OrderInput {
  const next = { ...order };
  if ((next.status === "arrived" || next.status === "done") && !next.arrivedOn) next.arrivedOn = today;
  if (next.status !== "to-order" && next.status !== "cancelled" && !next.orderedOn) next.orderedOn = today;
  return next;
}

export interface OrderRow {
  id: string;
  kind: string;
  status: string;
  expectedOn: string | null;
  costCents: number | null;
}

/** Still on its way and past the expected date. */
export function isLate(o: Pick<OrderRow, "status" | "expectedOn">, today: string): boolean {
  return OPEN_STATUSES.includes(o.status as OrderStatus) && !!o.expectedOn && o.expectedOn < today;
}

/** Counts for the top of the page. */
export function summarize(orders: OrderRow[], today: string) {
  const open = orders.filter((o) => OPEN_STATUSES.includes(o.status as OrderStatus));
  return {
    needsOrdering: orders.filter((o) => o.status === "to-order").length,
    onTheWay: orders.filter((o) => o.status === "ordered" || o.status === "shipped").length,
    late: orders.filter((o) => isLate(o, today)).length,
    arrivedNotDone: orders.filter((o) => o.status === "arrived").length,
    openCostCents: open.reduce((sum, o) => sum + (o.costCents ?? 0), 0),
  };
}

/** Page order: late first, then needs ordering, on the way (soonest expected first), arrived, then done/cancelled newest first. */
export function sortOrders<T extends OrderRow & { createdAt: string | Date }>(orders: T[], today: string): T[] {
  const rank = (o: T) =>
    isLate(o, today) ? 0 : o.status === "to-order" ? 1 : o.status === "ordered" || o.status === "shipped" ? 2 : o.status === "arrived" ? 3 : 4;
  return [...orders].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    if (rank(a) <= 2) {
      const ea = a.expectedOn ?? "9999-99-99";
      const eb = b.expectedOn ?? "9999-99-99";
      if (ea !== eb) return ea < eb ? -1 : 1;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/** Today's date (YYYY-MM-DD) in the business time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
