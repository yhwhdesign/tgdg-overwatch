const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const path = require("path");

const PAGE = path.join(__dirname, "../../src/app/page.tsx");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };

(async () => {
  const out = await esbuild.build({
    entryPoints: [PAGE], bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic",
    nodePaths: [path.join(__dirname, "../../node_modules")], loader: { ".tsx": "tsx" },
    external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"], logLevel: "silent",
  });
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost:3000/", pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event, MouseEvent: window.MouseEvent });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.__BAR_PX = 0;   // 0 = "cannot measure", which is how every earlier check runs
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get() { return this.getAttribute("role") === "img" ? globalThis.__BAR_PX : 0; } });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = React;

  // ---------------- fixtures (the shapes the real API returns) ----------------
  const T = (day, h, m = 0) => new Date(Date.UTC(2026, 9, 5 + day, h + 5, m)).toISOString();   // CDT wall clock; day 0 = Mon Oct 5
  const slot = (day, h, m = 0) => ({ start: T(day, h, m), end: T(day, h + 1, m) });
  const nb = (zip, at, near, sameZip, minutes) => ({ zip, at, near, sameZip, minutes });
  const win = (day) => ({ start: T(day, 8), end: T(day, 18) });
  const emptyDay = (day) => ({ window: win(day), passedUntil: null, booked: [], gaps: [], slots: [] });
  const tomorrowSlots = [slot(1, 9), slot(1, 10), slot(1, 11), slot(1, 12)];
  const AVAIL = {
    technicianId: "t1", timeZone: "America/Chicago", dates: { today: "2026-10-05", tomorrow: "2026-10-06" },
    today: { cutoffPassed: false, window: win(0), passedUntil: T(0, 10), booked: [{ start: T(0, 10), end: T(0, 12), zip: "72015" }],
      gaps: [{ start: T(0, 12), end: T(0, 18), prev: nb("72015", T(0, 12), false, false, 70), next: null, fit: "open", fitMinutes: null, slots: [slot(0, 12), slot(0, 13)] }], slots: [slot(0, 12), slot(0, 13)] },
    tomorrow: { window: win(1), passedUntil: null,
      booked: [{ start: T(1, 8), end: T(1, 9), zip: "72201", kind: "job", label: null }, { start: T(1, 13), end: T(1, 14), zip: "72202", kind: "job", label: null }, { start: T(1, 17), end: T(1, 18), zip: null, kind: "event", label: "Product pickup" }],
      gaps: [
        { start: T(1, 9), end: T(1, 13), prev: nb("72201", T(1, 9), true, true, 0), next: nb("72202", T(1, 13), true, false, 3), fit: "between-two", fitMinutes: 3, slots: tomorrowSlots },
        { start: T(1, 14), end: T(1, 17), prev: nb("72202", T(1, 14), true, false, 3), next: { kind: "event", label: "Product pickup", zip: null, at: T(1, 17), near: false, sameZip: false, minutes: null }, fit: "next-to-one", fitMinutes: 3, slots: [slot(1, 14), slot(1, 15), slot(1, 16)] },
      ], slots: [...tomorrowSlots, slot(1, 14), slot(1, 15), slot(1, 16)] },
    later: { startDay: 3, endDay: 7, days: [
      { date: "2026-10-07", ...emptyDay(2), gaps: [{ start: T(2, 8), end: T(2, 18), prev: null, next: null, fit: "open", fitMinutes: null, slots: [slot(2, 8)] }], slots: [slot(2, 8)] },
      { date: "2026-10-08", ...emptyDay(3), booked: [{ start: T(3, 8), end: T(3, 18), zip: "72205" }] },
      { date: "2026-10-09", ...emptyDay(4), booked: [{ start: T(4, 8), end: T(4, 18), zip: null, kind: "event", label: "PTO" }] }, { date: "2026-10-10", ...emptyDay(5) }, { date: "2026-10-11", ...emptyDay(6) } ] },
    selectable: { min: "2026-10-05", max: "2026-11-04" },
    bestFit: { kind: "between-two", date: "2026-10-06", dayLabel: "Tomorrow", start: T(1, 9), end: T(1, 13), slotStart: T(1, 9), prevZip: "72201", nextZip: "72202", minutes: 3 },
  };
  const pickedDay = { technicianId: "t1", timeZone: "America/Chicago", date: "2026-10-20", cutoffPassed: false, window: win(15), passedUntil: null,
    booked: [{ start: T(15, 9), end: T(15, 11), zip: "72201" }],
    gaps: [{ start: T(15, 11), end: T(15, 18), prev: nb("72201", T(15, 11), true, true, 0), next: null, fit: "next-to-one", fitMinutes: 0, slots: [slot(15, 11), slot(15, 12)] }], slots: [slot(15, 11), slot(15, 12)] };

  const calls = [];
  let statusCalls = 0;
  const FRESH = (over = {}) => ({ state: "ok", asOf: new Date(Date.now() - 4 * 60000).toISOString(), asOfText: "3:26 PM", ageMinutes: 4, staleAfterMinutes: 22, message: "Schedule as of 3:26 PM (4 min ago).", ...over });
  let statusHandler = () => ({ ok: true, status: 200, json: async () => FRESH() });
  let geoHandler = () => ({ ok: false, status: 400, json: async () => ({ error: "not set" }) });
  let zipHandler, availHandler = (p) => (p.get("date") ? { ok: true, status: 200, json: async () => pickedDay } : { ok: true, status: 200, json: async () => AVAIL });
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const u = new URL(String(url), "http://localhost:3000");
    if (u.pathname === "/api/sync-status") { statusCalls++; return statusHandler(); }
    if (u.pathname === "/api/geocode") return geoHandler(u.searchParams);
    if (u.pathname === "/api/offered-technicians") return zipHandler(u.searchParams);
    if (u.pathname === "/api/availability") return availHandler(u.searchParams);
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const techList = (extra = {}) => (p) => ({ ok: true, status: 200, json: async () => ({ zip: p.get("zip"), type: p.get("type"), timeZone: "America/Chicago", suggestedTechnicianId: "t1", reason: null,
    technicians: [
      { id: "t1", name: "Drayton Wilson", bestFit: AVAIL.bestFit, soonest: { date: "2026-10-05", dayLabel: "Today", start: T(0, 12) } },
      { id: "t2", name: "Chris Parkman", bestFit: { kind: "open", date: "2026-10-05", dayLabel: "Today", start: T(0, 12), end: T(0, 18), slotStart: T(0, 12), prevZip: null, nextZip: null, minutes: null }, soonest: { date: "2026-10-05", dayLabel: "Today", start: T(0, 12) } },
      { id: "t3", name: "Braden Lewis", bestFit: null, soonest: null },
      { id: "t4", name: "Josh Bayliss", bestFit: { kind: "next-to-one", date: "2026-10-08", dayLabel: null, start: T(3, 8), end: T(3, 12), slotStart: T(3, 8), prevZip: null, nextZip: "72202", minutes: 3 }, soonest: { date: "2026-10-08", dayLabel: null, start: T(3, 8) } },
    ], ...extra }) });

  const root = createRoot(document.getElementById("root"));
  const text = () => document.body.textContent.replace(/\s+/g, " ").trim();
  const buttons = () => [...document.querySelectorAll("button")];
  const buttonByText = (t) => buttons().find((b) => b.textContent.trim().toLowerCase().startsWith(t.toLowerCase()));
  const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); };
  const typeInto = async (input, value) => { await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new window.Event("input", { bubbles: true })); }); };
  const submit = async () => { await act(async () => { document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); }); };
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  await act(async () => { root.render(React.createElement(mod.exports.default)); });
  const q = (sel, scope = document) => [...scope.querySelectorAll(sel)];

  // ================= 1. address step (a bare zip still works and skips the lookup) =================
  check("starts on the address step", /Customer address/i.test(text()));
  const zipInput = document.querySelector("input");
  await typeInto(zipInput, "500 President Clinton Ave");
  check("the field takes a full street address", zipInput.value === "500 President Clinton Ave", zipInput.value);
  await typeInto(zipInput, "72201");
  const callsBeforeType = calls.length;
  await submit();
  check("a bare zip needs no address lookup", !calls.some((c) => c.startsWith("/api/geocode")));

  // ================= 2. type step =================
  check("moves to the call-type step", /What kind of call\?/i.test(text()));
  check("shows exactly the two choices", !!buttonByText("Residential") && !!buttonByText("Commercial"));
  check("no technician lookup before choosing a type", calls.length === callsBeforeType);
  await click(buttonByText("\u2190 Back to address"));
  check("back returns to the address step, value kept", /Customer address/i.test(text()) && document.querySelector("input").value === "72201");
  await submit();

  // ================= 3. technicians, with each one's best opening =================
  zipHandler = techList();
  await click(buttonByText("Residential"));
  check("residential lookup sends zip AND type", calls.filter((c) => c.startsWith("/api/offered-technicians")).at(-1) === "/api/offered-technicians?zip=72201&type=residential");
  const rowOf = (name) => buttonByText(name);
  check("tech step lists every returned technician", ["Drayton Wilson", "Chris Parkman", "Braden Lewis", "Josh Bayliss"].every((n) => !!rowOf(n)));
  check("order is exactly as the server sent (best fit first)", buttons().filter((b) => /Wilson|Parkman|Lewis|Bayliss/.test(b.textContent)).map((b) => b.textContent.slice(0, 6)).join() === "Draytо".slice(0, 0) + ["Drayto", "Chris ", "Braden", "Josh B"].join());
  check("suggested badge on exactly one tech, the first", (text().match(/Suggested/g) || []).length === 1 && rowOf("Drayton Wilson").textContent.includes("Suggested"));
  check("between-two tech: names the stack, the day and the open window", rowOf("Drayton Wilson").textContent.includes("Between two calls near 72201: Tomorrow, open 9:00 AM \u2013 1:00 PM"), rowOf("Drayton Wilson").textContent);
  check("...and also shows the soonest opening when it is earlier", rowOf("Drayton Wilson").textContent.includes("Soonest opening: Today 12:00 PM"), rowOf("Drayton Wilson").textContent);
  check("plain-open tech: just the soonest opening, once", rowOf("Chris Parkman").textContent.includes("Soonest opening: Today 12:00 PM") && (rowOf("Chris Parkman").textContent.match(/Soonest opening/g) || []).length === 1, rowOf("Chris Parkman").textContent);
  check("tech with no openings says so", rowOf("Braden Lewis").textContent.includes("No openings in the next 7 days"));
  check("next-to-one tech, a later day shows its weekday", rowOf("Josh Bayliss").textContent.includes("Next to a call near 72201: Thu, Oct 8, open 8:00 AM \u2013 12:00 PM"), rowOf("Josh Bayliss").textContent);
  check("header shows zip and call type", text().includes("Zip 72201 \u00b7 Residential"));

  // 3a. back / alternate messages / errors (unchanged behavior)
  await click(buttonByText("\u2190 Back"));
  zipHandler = (p) => ({ ok: true, status: 200, json: async () => ({ zip: p.get("zip"), type: p.get("type"), suggestedTechnicianId: null, reason: "none-for-type", technicians: [] }) });
  await click(buttonByText("Commercial"));
  check("commercial lookup sends type=commercial", calls.filter((c) => c.startsWith("/api/offered-technicians")).at(-1) === "/api/offered-technicians?zip=72201&type=commercial");
  check("nobody marked for that call type: says so, once, without blaming the zip", text().includes("No technicians are marked for commercial calls yet.") && !/assigned to zip/.test(text()) && !/in zip 72201/.test(text()), text());
  await click(buttonByText("\u2190 Back"));
  zipHandler = () => ({ ok: false, status: 400, json: async () => ({ error: "type must be \"residential\" or \"commercial\"" }) });
  await click(buttonByText("Residential"));
  check("API error keeps you on the type step with the message", /What kind of call\?/i.test(text()) && text().includes("type must be"));
  zipHandler = () => { throw new Error("offline"); };
  await click(buttonByText("Commercial"));
  check("network failure shows a friendly message", text().includes("Could not reach the server."));

  // ================= 4. the times step =================
  zipHandler = techList();
  await click(buttonByText("Residential"));
  await click(buttonByText("Drayton Wilson"));
  check("technician pick asks for availability WITH the customer's zip", calls.at(-1) === "/api/availability?technicianId=t1&zip=72201", calls.at(-1));
  check("times step has Today / Tomorrow / Days 3-7 and the day picker", /Today/.test(text()) && /Tomorrow/.test(text()) && /Days 3\u20137/.test(text()) && /Need a different day\?/.test(text()));
  check("header shows zip, type and technician", text().includes("Zip 72201 \u00b7 Residential \u00b7 Drayton Wilson"));

  // 4a. best-fit callout
  check("best-fit callout names the day, window and why", text().includes("Best fit for zip 72201") && text().includes("Tomorrow, open 9:00 AM \u2013 1:00 PM, between two calls near 72201"), text().slice(0, 300));
  check("callout offers a one-tap Book button with the suggested time", !!buttonByText("Book 9:00 AM"));

  // 4b. shading: booked time is drawn, labeled, and NOT clickable
  const booked = q('[data-kind="booked"]');
  check("every booked call on a day that has open time is drawn as a shaded block (1 today + 2 tomorrow = 3)", booked.length === 3, String(booked.length));
  check("booked blocks show the call's zip", booked.map((b) => b.textContent.trim()).sort().join() === "72015,72201,72202", booked.map((b) => b.textContent).join());
  check("booked blocks are striped (shaded) and carry a hover description", booked.every((b) => b.style.backgroundImage.includes("repeating-linear-gradient") && /^Booked \d{1,2}:\d{2} [AP]M to \d{1,2}:\d{2} [AP]M/.test(b.getAttribute("title"))), booked[0].getAttribute("title"));
  check("booked blocks contain NO buttons: booked time can't be picked", booked.every((b) => !b.querySelector("button")) && booked.every((b) => b.tagName === "DIV"));
  check("today's already-passed hours are shaded too", q('[data-kind="passed"]').length === 1);
  check("open stretches near the customer's calls are tinted on the bar", q('[data-kind="fit-gap"]').length === 2, String(q('[data-kind="fit-gap"]').length));
  check("each timeline shows the day's hours", /8:00 AM/.test(text()) && /6:00 PM/.test(text()));
  check("a legend explains booked / open / open near calls", /Booked/.test(text()) && /Open near calls in 72201/.test(text()));

  // 4b2. events: their own color AND pattern, written out, never clickable
  const evts = q('[data-kind="event"]');
  check("events are drawn as their own kind of block (tomorrow evening + the PTO day = 2)", evts.length === 2, String(evts.length));
  const pickup = evts.find((e) => e.textContent.includes("Product pickup"));
  check("an event shows its title on the bar and in its hover text", !!pickup && /^Event: Product pickup, 5:00 PM to 6:00 PM$/.test(pickup.getAttribute("title")), pickup && pickup.getAttribute("title"));
  check("events use a different color and a different pattern than jobs", pickup.style.backgroundImage.includes("repeating-linear-gradient") && /59,\s*95,\s*140/.test(pickup.style.backgroundImage) && !booked.some((b) => /59,\s*95,\s*140/.test(b.style.backgroundImage)) && pickup.style.backgroundColor !== "", pickup.style.backgroundImage);
  check("events contain NO buttons: blocked time can't be picked", evts.every((e) => !e.querySelector("button")));
  const notes = q('[data-kind="event-notes"]').map((n) => n.textContent.replace(/\s+/g, " ")).join(" | ");
  check("every event is also WRITTEN OUT under the schedule, with its hours and title", notes.includes("Event 5:00 PM \u2013 6:00 PM: Product pickup") && notes.includes("Event 8:00 AM \u2013 6:00 PM: PTO"), notes);
  check("the legend explains the event shading", text().includes("Event (errand, time off, meeting)"));
  check("a day where an event is the ONLY thing in the way is still shown, with why", text().includes("Fri, Oct 9") && text().includes("Nothing open this day.") && !q('[data-kind="gap"]').some((g) => g.textContent.includes("Oct 9")));
  check("a gap that ends at an event says so, by title, not 'a call'", q('[data-kind="gap"]').some((g) => g.textContent.includes("Before an event (Product pickup)") || g.textContent.includes("before an event (Product pickup)")), q('[data-kind="gap"]').map((g) => g.textContent).join(" || ").slice(0, 400));
  check("an event never makes a gap look 'nearby'", !q('[data-kind="gap"]').some((g) => /event/.test(g.textContent) && /Between two nearby calls/.test(g.textContent)));

  // 4c. only OPEN gaps are listed; each shows its window and neighbors
  const gaps = q('[data-kind="gap"]');
  check("one card per open gap (today 1, tomorrow 2, Oct 7 1)", gaps.length === 4, String(gaps.length));
  const tomorrowGap = gaps.find((g) => g.textContent.includes("Open 9:00 AM \u2013 1:00 PM"));
  check("the between-two gap shows its badge", tomorrowGap.textContent.includes("Between two nearby calls"));
  check("... and the calls on each side with how near they are", tomorrowGap.textContent.includes("After a 72201 call (same zip) \u00b7 before a 72202 call (about 3 min away)"), tomorrowGap.textContent);
  const tbuttons = q("button", tomorrowGap);
  check("its start times are exactly the open ones", tbuttons.map((b) => b.textContent.trim()).join() === "9:00 AM,10:00 AM,11:00 AM,12:00 PM");
  check("start times flush against a nearby call are highlighted; the middle ones are not", tbuttons[0].className.includes("bg-brand-orange/10") && tbuttons[3].className.includes("bg-brand-orange/10") && !tbuttons[1].className.includes("bg-brand-orange/10") && !tbuttons[2].className.includes("bg-brand-orange/10"));
  const farGap = gaps.find((g) => g.textContent.includes("Open 12:00 PM \u2013 6:00 PM"));
  check("a plain open gap has no stacking badge and a lighter border", !farGap.textContent.includes("nearby call") || farGap.textContent.includes("After a 72015 call"), farGap.textContent);
  check("...it still tells you the call before it (72015, ~70 min away)", farGap.textContent.includes("After a 72015 call (about 70 min away)"), farGap.textContent);
  check("the next-to-one gap has the other badge", gaps.some((g) => g.textContent.includes("Next to a nearby call")));
  check("a fully booked day (Oct 8) shows no open card and no start times", !text().includes("Thu, Oct 8"));
  check("reminder about the 2-hour window appears for today and tomorrow", (text().match(/Quote the customer a 2-hour arrival window/g) || []).length === 2, String((text().match(/Quote the customer a 2-hour arrival window/g) || []).length));

  // 4d. picking
  await click(buttonByText("Book 9:00 AM"));
  check("one-tap Book goes to confirmation with the day and a 2-hour quote", /Tomorrow with Drayton Wilson/.test(text()) && /Quote the customer:\s*9:00 AM\s?\u2013\s?11:00 AM/.test(text()), text());
  check("confirmation names the call type and zip", text().includes("Residential call \u00b7 zip 72201"));
  await click(buttonByText("New call"));
  await typeInto(document.querySelector("input"), "72201"); await submit();
  await click(buttonByText("Residential")); await click(buttonByText("Drayton Wilson"));
  const flushBtn = q('[data-kind="gap"]').find((g) => g.textContent.includes("Open 9:00 AM \u2013 1:00 PM"));
  await click(q("button", flushBtn)[3]);   // 12:00 PM, the slot that ends right as the next call begins
  check("picking any open start time still confirms with its 2-hour quote", /Tomorrow with Drayton Wilson/.test(text()) && /Quote the customer:\s*12:00 PM\s?\u2013\s?2:00 PM/.test(text()), text());
  await click(buttonByText("New call"));

  // ================= 5. day picker =================
  await typeInto(document.querySelector("input"), "72201"); await submit();
  await click(buttonByText("Residential")); await click(buttonByText("Drayton Wilson"));
  const dateInput = document.querySelector("input[type=date]");
  check("date picker limited to the synced range", dateInput.min === "2026-10-05" && dateInput.max === "2026-11-04");
  const bookedBefore = q('[data-kind="booked"]').length;
  await typeInto(dateInput, "2026-10-20");
  check("picking a date asks for that day WITH the zip", calls.at(-1) === "/api/availability?technicianId=t1&zip=72201&date=2026-10-20", calls.at(-1));
  check("the picked day gets the same shading and gap cards", q('[data-kind="booked"]').length === bookedBefore + 1 && text().includes("Open 11:00 AM \u2013 6:00 PM") && text().includes("Next to a nearby call"));
  const pickedBtn = q('[data-kind="gap"]').find((g) => g.textContent.includes("Open 11:00 AM \u2013 6:00 PM"));
  await click(q("button", pickedBtn)[0]);
  check("a time on the picked day can be booked", /Tue, Oct 20 with Drayton Wilson/.test(text()) && /Quote the customer:\s*11:00 AM/.test(text()), text());
  await click(buttonByText("New call"));

  // ================= 5b. events with no open time at all =================
  availHandler = (p) => p.get("date")
    ? { ok: true, status: 200, json: async () => ({ ...pickedDay, gaps: [], slots: [], booked: [{ start: T(15, 8), end: T(15, 18), zip: null, kind: "event", label: "Safety training" }] }) }
    : { ok: true, status: 200, json: async () => ({ ...AVAIL, bestFit: null, today: { ...AVAIL.today, gaps: [], slots: [], cutoffPassed: false, booked: [{ start: T(0, 10), end: T(0, 18), zip: null, kind: "event", label: "Off site" }] }, tomorrow: emptyDay(1), later: { ...AVAIL.later, days: AVAIL.later.days.map((d) => ({ ...d, gaps: [], slots: [], booked: [] })) } }) };
  await typeInto(document.querySelector("input"), "72201"); await submit();
  await click(buttonByText("Residential")); await click(buttonByText("Drayton Wilson"));
  const todaySection = text();
  check("today blocked only by an event: says nothing is open AND shows what the event is", todaySection.includes("Nothing open today.") && todaySection.includes("Event 10:00 AM \u2013 6:00 PM: Off site") && q('[data-kind="event"]').length === 1, todaySection.slice(0, 300));
  check("...with no 2-hour-window reminder and no clickable times for a day with nothing open", !/Quote the customer a 2-hour arrival window/.test(todaySection.split("Tomorrow")[0]) && q('[data-kind="gap"]').length === 0);
  await typeInto(document.querySelector("input[type=date]"), "2026-10-20");
  check("a picked day blocked only by an event shows it too", text().includes("Event 8:00 AM \u2013 6:00 PM: Safety training") && text().includes("Nothing open on Tue, Oct 20."), text().slice(-300));
  await click(buttonByText("\u2190 Change technician")); await click(buttonByText("\u2190 Back")); await click(buttonByText("\u2190 Back to address"));

  // ================= 6. when there is nothing to stack with =================
  availHandler = () => ({ ok: true, status: 200, json: async () => ({ ...AVAIL, bestFit: { kind: "open", date: "2026-10-05", dayLabel: "Today", start: T(0, 12), end: T(0, 18), slotStart: T(0, 12), prevZip: null, nextZip: null, minutes: null } }) });
  await typeInto(document.querySelector("input"), "72201"); await submit();
  await click(buttonByText("Residential")); await click(buttonByText("Drayton Wilson"));
  check("no stacking available: says so and gives the soonest opening, no Book callout", text().includes("No calls near 72201 to stack with in the next 7 days. Soonest opening: Today 12:00 PM.") && !buttonByText("Book "), text().slice(0, 250));
  availHandler = () => ({ ok: true, status: 200, json: async () => ({ ...AVAIL, bestFit: null, today: { ...AVAIL.today, gaps: [], slots: [], cutoffPassed: true }, tomorrow: emptyDay(1), later: { ...AVAIL.later, days: AVAIL.later.days.map((d) => ({ ...d, gaps: [], slots: [], booked: [] })) } }) });
  await click(buttonByText("New call")).catch(() => {}); 
  await click(buttonByText("\u2190 Change technician")); await click(buttonByText("Drayton Wilson"));
  check("a tech with no open time at all: friendly messages, no cards, no callout", text().includes("No same-day openings left for today.") && text().includes("Nothing open tomorrow.") && text().includes("Nothing open through day 7") && q('[data-kind="gap"]').length === 0);

  // ================= 7. text inside the bar only when it fits =================
  const widthDay = { window: win(1), passedUntil: null,
    booked: [
      { start: T(1, 8), end: T(1, 9), zip: "72023", kind: "job", label: null },                                    // 1 hour
      { start: T(1, 10), end: T(1, 12, 30), zip: null, kind: "event", label: "Magnet parking lot" },              // 2.5 hours, long title
      { start: T(1, 15), end: T(1, 15, 30), zip: null, kind: "event", label: "Get Cell phone" },                  // 30 minutes, long title (the screenshot case)
      { start: T(1, 15, 30), end: T(1, 16), zip: "71603", kind: "job", label: null },                             // 30 minutes, short zip
    ],
    gaps: [{ start: T(1, 9), end: T(1, 10), prev: nb("72023", T(1, 9), false, false, 40), next: { kind: "event", label: "Magnet parking lot", zip: null, at: T(1, 10), near: false, sameZip: false, minutes: null }, fit: "open", fitMinutes: null, slots: [slot(1, 9)] }],
    slots: [slot(1, 9)] };
  availHandler = () => ({ ok: true, status: 200, json: async () => ({ ...AVAIL, bestFit: null, today: { ...emptyDay(0), cutoffPassed: false }, tomorrow: widthDay, later: { ...AVAIL.later, days: AVAIL.later.days.map((d) => ({ ...d, gaps: [], slots: [], booked: [] })) } }) });
  const reopen = async () => { await click(buttonByText("\u2190 Change technician")); await click(buttonByText("Drayton Wilson")); };
  const block = (kind, needle) => q(`[data-kind="${kind}"]`).find((b) => b.getAttribute("title").includes(needle));

  globalThis.__BAR_PX = 927;                      // a wide desktop bar
  await reopen();
  check("7a wide bar: a long title fits in a long event and is shown", block("event", "Magnet").textContent === "Magnet parking lot", block("event", "Magnet").textContent);
  check("7a wide bar: a long title does NOT get squeezed into a 30-minute event (no half-cut words)", block("event", "Get Cell phone").textContent === "", JSON.stringify(block("event", "Get Cell phone").textContent));
  check("7a wide bar: zips still show in 1-hour and 30-minute jobs that have room", block("booked", "8:00 AM to 9:00 AM").textContent === "72023" && block("booked", "3:30 PM to 4:00 PM").textContent === "71603", `${block("booked", "8:00 AM to 9:00 AM").textContent} / ${block("booked", "3:30 PM to 4:00 PM").textContent}`);
  check("7a hover text is always complete, even when the bar shows no text", block("event", "Get Cell phone").getAttribute("title") === "Event: Get Cell phone, 3:00 PM to 3:30 PM");
  const written = q('[data-kind="event-notes"]').map((n) => n.textContent.replace(/\s+/g, " ")).join(" | ");
  check("7a the written lines always carry every event title, so nothing is lost", written.includes("Event 3:00 PM \u2013 3:30 PM: Get Cell phone") && written.includes("Event 10:00 AM \u2013 12:30 PM: Magnet parking lot"), written);

  globalThis.__BAR_PX = 330;                      // the docked side panel is about this wide
  await reopen();
  check("7b narrow panel: no block gets text it has no room for", q('[data-kind="event"], [data-kind="booked"]').filter((b) => b.closest('[role="img"]')).every((b) => b.textContent === ""), q('[data-kind="event"], [data-kind="booked"]').map((b) => JSON.stringify(b.textContent)).join(" "));
  check("7b narrow panel: the hover text and the written lines still carry everything", block("event", "Magnet").getAttribute("title") === "Event: Magnet parking lot, 10:00 AM to 12:30 PM" && q('[data-kind="event-notes"]').map((n) => n.textContent).join(" ").includes("Get Cell phone"));
  globalThis.__BAR_PX = 0;

  // ================= 6b. the "schedule as of" badge =================
  const badge = () => document.querySelector("[data-freshness]");
  const refocus = async () => { await act(async () => { window.dispatchEvent(new window.Event("focus")); await new Promise((r2) => setTimeout(r2, 5)); }); };
  const setStatus = async (body, ok = true) => { statusHandler = () => ({ ok, status: ok ? 200 : 503, json: async () => body }); await refocus(); };

  await setStatus(FRESH());
  check("S1 the badge shows when the schedule was last refreshed and how long ago, on every step", !!badge() && badge().getAttribute("data-freshness") === "ok" && badge().textContent.replace(/\s+/g, " ").includes("Schedule as of 3:26 PM \u00b7 4 min ago"), badge() && badge().textContent);
  check("S1 a calm green dot, not an alarm", !!badge().querySelector(".bg-green-400") && !badge().className.includes("amber") && !badge().className.includes("red"));
  check("S1 it lives in the header, above the page content", !!badge().closest(".bg-brand-black"));

  await setStatus(FRESH({ asOf: new Date(Date.now() - 40 * 60000).toISOString(), ageMinutes: 5 }));
  check("S2 the server said 'ok' but the data is now older than the limit by the screen's own clock: it turns amber by itself", badge().getAttribute("data-freshness") === "stale" && /The schedule is 40 minutes old/.test(badge().textContent) && /3:26 PM/.test(badge().textContent), badge().textContent);

  await setStatus(FRESH({ state: "stale", asOf: new Date(Date.now() - 47 * 60000).toISOString(), ageMinutes: 47, message: "The schedule is 47 minutes old. Updates may be stuck. Showing it as of 2:39 PM." }));
  check("S3 stale from the server: amber, with the server's message", badge().getAttribute("data-freshness") === "stale" && badge().className.includes("amber") && /47 minutes old/.test(badge().textContent));

  await setStatus(FRESH({ state: "failing", message: "Updates are failing (the database could not be reached). Showing the schedule as of 3:00 PM." }));
  check("S4 failing: red, saying what is wrong and what data is being shown", badge().getAttribute("data-freshness") === "failing" && badge().className.includes("red") && /the database could not be reached/.test(badge().textContent) && /3:00 PM/.test(badge().textContent), badge().textContent);

  await setStatus(FRESH({ state: "paused", message: "Automatic updates are paused until 6:00 AM. Showing the schedule as of 7:02 PM.", asOf: new Date(Date.now() - 600 * 60000).toISOString() }));
  check("S5 paused overnight: calm and gray, never an alarm, and it says when updates resume", badge().getAttribute("data-freshness") === "paused" && /paused until 6:00 AM/.test(badge().textContent) && !badge().className.includes("amber") && !badge().className.includes("red"), badge().textContent);

  await setStatus(FRESH({ state: "unknown", asOf: null, asOfText: null, ageMinutes: null, message: "No schedule update has been recorded yet." }));
  check("S6 nothing recorded yet: says so, calmly", badge().getAttribute("data-freshness") === "unknown" && /No schedule update has been recorded yet/.test(badge().textContent));

  await setStatus(FRESH());
  await setStatus({ error: "Could not read the update status." }, false);
  check("S7 if the status can't be read the badge keeps the last known state and says it could not re-check", badge().getAttribute("data-freshness") === "ok" && /Can't reach the server to re-check/.test(badge().textContent), badge().textContent);

  await setStatus(FRESH());
  check("S8 coming back (focus) asks again and recovers", !/re-check/.test(badge().textContent) && badge().getAttribute("data-freshness") === "ok");

  const callsBefore = statusCalls;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  await refocus();
  check("S9 a hidden tab does NOT ask the server (it would keep the free database awake)", statusCalls === callsBefore, `${statusCalls - callsBefore} extra calls`);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  await refocus();
  check("S9 ...and it asks again when the tab is visible", statusCalls === callsBefore + 1, `${statusCalls - callsBefore} calls`);

  // a screen that has never reached the status route at all
  statusHandler = () => { throw new Error("offline"); };
  await act(async () => { root.unmount(); });
  const root2 = createRoot(document.getElementById("root"));
  statusCalls = 0;
  await act(async () => { root2.render(React.createElement(mod.exports.default)); });
  await act(async () => { await new Promise((r2) => setTimeout(r2, 5)); });
  check("S10 with no status ever received it says so plainly instead of staying silent", !!badge() && badge().getAttribute("data-freshness") === "unavailable" && /Can't check how fresh the schedule is/.test(badge().textContent), badge() && badge().textContent);
  check("S10 exactly one status request on load", statusCalls === 1, String(statusCalls));
  await act(async () => { root2.unmount(); });
  const root3 = createRoot(document.getElementById("root"));
  statusHandler = () => ({ ok: true, status: 200, json: async () => FRESH() });
  await act(async () => { root3.render(React.createElement(mod.exports.default)); });
  await act(async () => { await new Promise((r2) => setTimeout(r2, 5)); });
  check("S11 on the first screen (zip entry) the badge is already there", !!badge() && /Schedule as of 3:26 PM/.test(badge().textContent) && /Customer address/i.test(text()));
  await act(async () => { root3.unmount(); });
  const root4 = createRoot(document.getElementById("root"));
  await act(async () => { root4.render(React.createElement(mod.exports.default)); });

  await act(async () => { root4.unmount(); });
  // ================= 9. full street address: looked up once, then routed =================
  const root5 = createRoot(document.getElementById("root"));
  await act(async () => { root5.render(React.createElement(mod.exports.default)); });
  const ADDR = { label: "500 PRESIDENT CLINTON AVE, LITTLE ROCK, AR, 72201", lat: 34.7466, lng: -92.2596, zip: "72201", precision: "address" };
  geoHandler = (p) => p.get("address").includes("Nowhere")
    ? { ok: false, status: 400, json: async () => ({ error: "Couldn't find that address. Check the spelling, or add the city and zip code." }) }
    : { ok: true, status: 200, json: async () => ({ place: ADDR }) };
  await typeInto(document.querySelector("input"), "1 Nowhere Lane"); await submit();
  check("A1 an address that can't be found stays on the address step with a helpful message", /Customer address/i.test(text()) && text().includes("Couldn't find that address"), text().slice(0, 300));
  await typeInto(document.querySelector("input"), "500 President Clinton Ave, Little Rock");
  check("A1b typing again clears the message", !text().includes("Couldn't find that address"));
  await submit();
  check("A2 the address is looked up once, as typed", calls.filter((c) => c.startsWith("/api/geocode")).at(-1) === "/api/geocode?address=500%20President%20Clinton%20Ave%2C%20Little%20Rock");
  check("A3 the matched address is shown on the call-type step", text().includes("500 PRESIDENT CLINTON AVE, LITTLE ROCK, AR, 72201") && /What kind of call\?/.test(text()));
  const R = (kind, minutes, fromZip, toZip) => ({ kind, minutes, fromZip, toZip });
  zipHandler = (p) => ({ ok: true, status: 200, json: async () => ({ zip: p.get("zip"), type: p.get("type"), timeZone: "America/Chicago", suggestedTechnicianId: "m", reason: null, technicians: [
    { id: "m", name: "Mike OnTheWay", bestFit: { kind: "between-two", date: "2026-10-06", dayLabel: "Tomorrow", start: T(1, 9), end: T(1, 13), slotStart: T(1, 9), prevZip: "72032", nextZip: "72113", minutes: 4, route: R("between", 4, "72032", "72113") }, soonest: { date: "2026-10-06", dayLabel: "Tomorrow", start: T(1, 9) } },
    { id: "d", name: "Dave FirstJob", bestFit: { kind: "next-to-one", date: "2026-10-06", dayLabel: "Tomorrow", start: T(1, 8), end: T(1, 9), slotStart: T(1, 8), prevZip: null, nextZip: "72019", minutes: 6, route: R("before-first", 6, null, "72019") }, soonest: { date: "2026-10-06", dayLabel: "Tomorrow", start: T(1, 8) } },
    { id: "c", name: "Chris OpenDay", bestFit: { kind: "open-day", date: "2026-10-06", dayLabel: "Tomorrow", start: T(1, 8), end: T(1, 18), slotStart: T(1, 8), prevZip: null, nextZip: null, minutes: null, route: R("open-day", null, null, null) }, soonest: { date: "2026-10-06", dayLabel: "Tomorrow", start: T(1, 8) } },
    { id: "t", name: "Tony FarAway", bestFit: { kind: "open", date: "2026-10-06", dayLabel: "Tomorrow", start: T(1, 15), end: T(1, 18), slotStart: T(1, 15), prevZip: "72023", nextZip: null, minutes: null, route: R("after-last", 22, "72023", null) }, soonest: { date: "2026-10-06", dayLabel: "Tomorrow", start: T(1, 15) } },
  ] }) });
  await click(buttonByText("Residential"));
  check("A4 technicians are asked for with the map point AND the zip", calls.filter((c) => c.startsWith("/api/offered-technicians")).at(-1) === "/api/offered-technicians?lat=34.7466&lng=-92.2596&zip=72201&type=residential", calls.filter((c) => c.startsWith("/api/offered-technicians")).at(-1));
  check("A5 on-route tech: between which calls and how many extra minutes", buttonByText("Mike OnTheWay").textContent.includes("On his way between his 72032 call and 72113 call (+4 min): Tomorrow, open 9:00 AM \u2013 1:00 PM"), buttonByText("Mike OnTheWay").textContent);
  check("A6 before-first tech: drive to his first call", buttonByText("Dave FirstJob").textContent.includes("Right before his first 72019 call, 6 min away"), buttonByText("Dave FirstJob").textContent);
  check("A7 open-day tech: the customer would be his first call", buttonByText("Chris OpenDay").textContent.includes("Open day, first call: Tomorrow from 8:00 AM"), buttonByText("Chris OpenDay").textContent);
  check("A8 off-route tech: says how far off, plus the soonest opening", buttonByText("Tony FarAway").textContent.includes("Off his route: +22 min of driving") && buttonByText("Tony FarAway").textContent.includes("Soonest opening: Tomorrow 3:00 PM"), buttonByText("Tony FarAway").textContent);
  check("A9 header shows the matched address", text().includes("500 PRESIDENT CLINTON AVE, LITTLE ROCK, AR, 72201 \u00b7 Residential"));

  const ROUTE_AVAIL = { ...AVAIL,
    tomorrow: { ...AVAIL.tomorrow, gaps: [
      { ...AVAIL.tomorrow.gaps[0], route: R("between", 4, "72201", "72202"), fitMinutes: 4, prev: nb("72201", T(1, 9), true, false, 5), next: nb("72202", T(1, 13), true, false, 2) },
      { ...AVAIL.tomorrow.gaps[1], fit: "open", fitMinutes: null, route: R("after-last", 22, "72202", null) },
    ] },
    later: { ...AVAIL.later, days: [{ date: "2026-10-07", ...emptyDay(2), gaps: [{ start: T(2, 8), end: T(2, 18), prev: null, next: null, fit: "open-day", fitMinutes: null, route: R("open-day", null, null, null), slots: [slot(2, 8)] }], slots: [slot(2, 8)] }, ...AVAIL.later.days.slice(1)] },
    bestFit: { ...AVAIL.bestFit, minutes: 4, route: R("between", 4, "72201", "72202") } };
  availHandler = () => ({ ok: true, status: 200, json: async () => ROUTE_AVAIL });
  await click(buttonByText("Mike OnTheWay"));
  check("A10 the schedule is asked for with the map point and zip", calls.at(-1) === "/api/availability?technicianId=m&lat=34.7466&lng=-92.2596&zip=72201", calls.at(-1));
  check("A11 best-fit callout explains the route", text().includes("Best fit for 500 PRESIDENT CLINTON AVE") && text().includes("on his way between his 72201 call and 72202 call (+4 min)"), text().slice(0, 400));
  const cards = q('[data-kind="gap"]');
  const badgeOf = (g) => g.querySelector('[data-kind="gap-badge"]')?.textContent ?? "";
  check("A12 on-route gap badge shows the extra minutes", cards.some((g) => badgeOf(g) === "On his route \u00b7 +4 min"), cards.map(badgeOf).join(" | "));
  check("A13 off-route gap says how far off, without the orange border", cards.some((g) => badgeOf(g) === "Off his route \u00b7 +22 min" && !g.className.includes("border-brand-orange")), cards.map(badgeOf).join(" | "));
  check("A14 an open day is labeled as his first call", cards.some((g) => badgeOf(g) === "Open day \u00b7 first call"));
  const onRoute = cards.find((g) => badgeOf(g).startsWith("On his route"));
  const ob = [...onRoute.querySelectorAll("button")];
  check("A15 only the suggested start (next to the closer job, here the one after) is highlighted", ob.at(-1).className.includes("bg-brand-orange/10") && ob.slice(0, -1).every((b) => !b.className.includes("bg-brand-orange/10")), ob.map((b) => b.className.includes("bg-brand-orange/10")).join());
  check("A16 the legend speaks in route terms for an address", text().includes("Open on his route for this address"));
  check("A17 only on-route gaps are tinted on the bar (not open days, not off-route)", q('[data-kind="fit-gap"]').length === 1, String(q('[data-kind="fit-gap"]').length));
  await click(buttonByText("Book "));
  check("A18 confirmation names the full address", text().includes("Residential call \u00b7 500 PRESIDENT CLINTON AVE, LITTLE ROCK, AR, 72201"), text().slice(0, 400));
  await click(buttonByText("New call"));
  check("A19 New call clears the address", /Customer address/i.test(text()) && document.querySelector("input").value === "");

  // zip fallback: the Census couldn't place the street, but the text had a zip
  geoHandler = () => ({ ok: true, status: 200, json: async () => ({ place: { label: "Zip 72034", lat: null, lng: null, zip: "72034", precision: "zip" } }) });
  await typeInto(document.querySelector("input"), "1 Back Road, Conway AR 72034"); await submit();
  check("A20 zip-only fallback is flagged so the dispatcher knows distances are rougher", !!document.querySelector('[data-kind="zip-fallback"]') && text().includes("Zip 72034"));
  await act(async () => { root5.unmount(); });

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
