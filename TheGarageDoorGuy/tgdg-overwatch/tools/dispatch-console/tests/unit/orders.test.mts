// Order tracker rules (no database).
import { parseOrderInput, parseVendorInput, parseMoney, safeLink, validDate, fillStatusDates, isLate, summarize, sortOrders, todayIn } from "../../src/lib/orders.ts";

let passes = 0, failures = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (ok) passes++; else { failures++; console.log(`FAIL ${name}  <- got ${JSON.stringify(got)} expected ${JSON.stringify(want)}`); } };

const ok = (r: { ok: boolean }) => r.ok;
const err = (r: { ok: boolean; error?: string }) => (r.ok ? null : (r as { error: string }).error);

// orders
const o = parseOrderInput({ items: "  2x springs  ", jobNumber: "#4521", cost: "$1,234.50", expectedOn: "2026-11-05" });
eq("O1 minimal order: defaults, trimmed, # stripped, dollars to cents", o.ok && [o.value.kind, o.value.status, o.value.items, o.value.jobNumber, o.value.costCents, o.value.expectedOn, o.value.poNumber], ["customer", "to-order", "2x springs", "4521", 123450, "2026-11-05", null]);
eq("O2 what was ordered is required", err(parseOrderInput({ items: "  " })), "Say what was ordered.");
eq("O3 bad status / kind refused", [ok(parseOrderInput({ items: "x", status: "lost" })), ok(parseOrderInput({ items: "x", kind: "rental" }))], [false, false]);
eq("O4 impossible dates refused", [ok(parseOrderInput({ items: "x", expectedOn: "2026-02-30" })), ok(parseOrderInput({ items: "x", orderedOn: "11/5/2026" }))], [false, false]);
eq("O5 bad cost refused, empty cost is null", [ok(parseOrderInput({ items: "x", cost: "abc" })), ok(parseOrderInput({ items: "x", cost: "-5" })), (parseOrderInput({ items: "x", cost: "" }) as { value: { costCents: null } }).value.costCents], [false, false, null]);
eq("O6 too-long text is refused, not cut", ok(parseOrderInput({ items: "x".repeat(1001) })), false);
eq("O7 non-text fields refused", ok(parseOrderInput({ items: 5 })), false);
eq("O8 junk bodies refused", [ok(parseOrderInput(null)), ok(parseOrderInput([])), ok(parseOrderInput("hi"))], [false, false, false]);
eq("O9 money parsing", [parseMoney("125.5"), parseMoney("1,000"), parseMoney(12.345), parseMoney("1.234")], [{ v: 12550 }, { v: 100000 }, { v: 1235 }, { error: "Cost must be a dollar amount, like 125.50." }]);
eq("O10 dates", [validDate("2028-02-29"), validDate("2027-02-29"), validDate(null)], [true, false, true]);

// status dates
const base = (o as { value: Parameters<typeof fillStatusDates>[0] }).value;
eq("S1 marking ordered fills today's ordered date", fillStatusDates({ ...base, status: "ordered" }, "2026-11-01").orderedOn, "2026-11-01");
eq("S2 marking arrived fills arrived (and ordered) dates", (({ orderedOn, arrivedOn }) => [orderedOn, arrivedOn])(fillStatusDates({ ...base, status: "arrived" }, "2026-11-01")), ["2026-11-01", "2026-11-01"]);
eq("S3 dates already typed are kept", fillStatusDates({ ...base, status: "arrived", arrivedOn: "2026-10-30" }, "2026-11-01").arrivedOn, "2026-10-30");
eq("S4 needs-ordering fills nothing", fillStatusDates({ ...base, status: "to-order" }, "2026-11-01").orderedOn, null);

// late / summary / sort
const T = "2026-11-01";
const rows = [
  { id: "a", kind: "customer", status: "ordered", expectedOn: "2026-10-30", costCents: 1000, createdAt: "2026-10-01" },
  { id: "b", kind: "customer", status: "to-order", expectedOn: null, costCents: 500, createdAt: "2026-10-02" },
  { id: "c", kind: "stock", status: "shipped", expectedOn: "2026-11-03", costCents: null, createdAt: "2026-10-03" },
  { id: "d", kind: "customer", status: "arrived", expectedOn: "2026-10-01", costCents: 9999, createdAt: "2026-10-04" },
  { id: "e", kind: "customer", status: "done", expectedOn: "2026-09-01", costCents: 50, createdAt: "2026-10-05" },
  { id: "f", kind: "customer", status: "ordered", expectedOn: "2026-11-02", costCents: 200, createdAt: "2026-10-06" },
];
eq("L1 late = still on its way and past expected; arrived/done never late", rows.map((r) => isLate(r, T)), [true, false, false, false, false, false]);
eq("L2 expected today is not late yet", isLate({ status: "ordered", expectedOn: T }, T), false);
eq("L3 summary counts and open cost", summarize(rows, T), { needsOrdering: 1, onTheWay: 3, late: 1, arrivedNotDone: 1, openCostCents: 1700 });
eq("L4 sort: late, needs ordering, on the way soonest first, arrived, closed", sortOrders(rows, T).map((r) => r.id), ["a", "b", "f", "c", "d", "e"]);
eq("L5 today in the business time zone", todayIn("America/Chicago", new Date("2026-11-02T03:00:00Z")), "2026-11-01");

// vendors
const v = parseVendorInput({ name: " Clopay Supply ", website: "clopay.com", portalUrl: "https://dealer.clopay.com/orders", email: "orders@clopay.com" });
eq("V1 vendor: trimmed, links made https", v.ok && [v.value.name, v.value.website, v.value.portalUrl, v.value.active], ["Clopay Supply", "https://clopay.com/", "https://dealer.clopay.com/orders", true]);
eq("V2 name required", err(parseVendorInput({ name: "" })), "The vendor needs a name.");
eq("V3 links that could run code are refused", [ok(parseVendorInput({ name: "x", website: "javascript:alert(1)" })), ok(parseVendorInput({ name: "x", portalUrl: "data:text/html,hi" })), ok(parseVendorInput({ name: "x", website: "localhost" }))], [false, false, false]);
eq("V4 passwords are never accepted", [err(parseVendorInput({ name: "x", password: "hunter2" })), ok(parseVendorInput({ name: "x", portalPassword: "a" })), ok(parseVendorInput({ name: "x", secret: "a" }))], ["Vendor passwords are never stored here.", false, false]);
eq("V5 bad email refused", ok(parseVendorInput({ name: "x", email: "nope" })), false);
eq("V6 safeLink", [safeLink("supplier.com/a"), safeLink("http://x.com"), safeLink("ftp://x.com"), safeLink("https://user:pw@x.com")], ["https://supplier.com/a", "http://x.com/", null, null]);

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
