const esbuild = require("esbuild");
const path = require("path");
const TMP = path.join(__dirname, "..", ".tmp");
require("fs").mkdirSync(TMP, { recursive: true });

const SRC = path.join(__dirname, "../../src");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };

(async () => {
  // Bundle the REAL route, swapping only the database for an in-memory fake.
  const fakePrisma = path.join(TMP, "fake-prisma.cjs");
  require("fs").writeFileSync(fakePrisma, `
    module.exports.prisma = {
      technician: { async findMany({ where }) { const allowed = where.classification.in; return globalThis.__DB.techs.filter((t) => allowed.includes(t.classification)).map((t) => ({ id: t.id, name: t.name, classification: t.classification })); } },
      appointment: { async findMany({ where }) { return globalThis.__DB.appts.filter((a) => a.techId === where.technicianId).map((a) => ({ startTime: a.start, endTime: a.end, zip: a.zip ?? null, lat: a.lat ?? null, lng: a.lng ?? null })); } },
    };`);
  const built = await esbuild.build({
    entryPoints: [`${SRC}/app/api/offered-technicians/route.ts`], bundle: true, write: false, format: "cjs", platform: "node",
    alias: { "@": SRC }, external: ["next/server"], logLevel: "silent",
    plugins: [{ name: "fake-prisma", setup(b) { b.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({ path: fakePrisma })); } }],
  });
  const NEXT = path.join(__dirname, "../../node_modules/next/server.js");
  const mod = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(mod, mod.exports, (id) => require(id === "next/server" ? NEXT : id));
  const { NextRequest } = require(NEXT);
  const get = async (qs) => { const r = await mod.exports.GET(new NextRequest(`http://localhost:3000/api/offered-technicians?${qs}`)); return { status: r.status, body: await r.json() }; };
  const names = (r) => r.body.technicians.map((t) => t.name).sort();

  const T = (id, name, classification, active = true) => ({ id, name, classification, active, hcpEmployeeId: `pro_${id}` });
  const now = Date.now(), DAY = 86400000;
  globalThis.__DB = {
    techs: [T("a", "Rita Resi", "residential"), T("b", "Carl Comm", "commercial"), T("c", "Hank Hybrid", "hybrid"), T("d", "Una Unset", null), T("e", "Fred Hybrid", "hybrid"),
            T("f", "Admin Amy", "hybrid", false) /* not 'active' in HCP terms, but the business classified her */, T("g", "Junk Jim", "everything")],
    appts: [],
  };

  // 1. the core rule: classification decides, the zip never does
  let r = await get("zip=72201&type=residential");
  check("residential call: residential + hybrid techs only", JSON.stringify(names(r)) === JSON.stringify(["Admin Amy", "Fred Hybrid", "Hank Hybrid", "Rita Resi"]), JSON.stringify(names(r)));
  r = await get("zip=72201&type=commercial");
  check("commercial call: commercial + hybrid techs only", JSON.stringify(names(r)) === JSON.stringify(["Admin Amy", "Carl Comm", "Fred Hybrid", "Hank Hybrid"]), JSON.stringify(names(r)));
  r = await get("zip=72201&type=residential");
  check("an unclassified tech is NEVER offered", !names(r).includes("Una Unset"));
  check("a tech with a junk classification value is never offered", !names(r).includes("Junk Jim"));
  check("a classified person who isn't 'active' in HCP terms IS offered (the business decided)", names(r).includes("Admin Amy"));
  check("response echoes zip and type, no reason when there are results", r.body.zip === "72201" && r.body.type === "residential" && r.body.reason === null);
  check("response never leaks internal fields (classification, HCP id)", r.body.technicians.every((t) => Object.keys(t).sort().join() === "bestFit,id,name,soonest"), JSON.stringify(Object.keys(r.body.technicians[0])));
  check("response names the business time zone", r.body.timeZone === "America/Chicago", r.body.timeZone);

  // 2. THE BUG: any zip must work, because zips never limit who is offered
  const base = JSON.stringify(names(await get("zip=72201&type=residential")));
  for (const zip of ["72204", "72118", "72015", "71601", "72701", "90210", "00000", "99999"]) {
    const x = await get(`zip=${zip}&type=residential`);
    check(`zip ${zip}: the same technicians are offered (no 'not assigned to this zip')`, x.status === 200 && JSON.stringify(names(x)) === base && x.body.reason === null, `${x.status} ${JSON.stringify(x.body.reason)} ${JSON.stringify(names(x))}`);
  }
  check("an Arkansas zip nobody ever worked in still returns techs", (await get("zip=72430&type=commercial")).body.technicians.length === 4);

  // 3. when nobody is marked for that kind of call, say so (and ONLY then)
  globalThis.__DB.techs = [T("a", "Rita Resi", "residential")];
  r = await get("zip=72201&type=commercial");
  check("nobody marked for commercial -> none-for-type, no suggestion", r.body.technicians.length === 0 && r.body.reason === "none-for-type" && r.body.suggestedTechnicianId === null, JSON.stringify(r.body));
  r = await get("zip=72201&type=residential");
  check("...but the residential call still finds her", JSON.stringify(names(r)) === JSON.stringify(["Rita Resi"]));
  globalThis.__DB.techs = [T("d", "Una Unset", null)];
  r = await get("zip=72201&type=residential");
  check("nobody classified at all -> none-for-type", r.body.technicians.length === 0 && r.body.reason === "none-for-type");
  globalThis.__DB.techs = [];
  r = await get("zip=72201&type=residential");
  check("an empty roster is handled the same way", r.body.reason === "none-for-type" && r.body.technicians.length === 0);

  // 4. suggestion = soonest opening among the OFFERED techs (Rita booked solid for 3 days, Hank free)
  globalThis.__DB.techs = [T("a", "Rita Resi", "residential"), T("c", "Hank Hybrid", "hybrid")];
  globalThis.__DB.appts = [{ techId: "a", start: new Date(now - DAY), end: new Date(now + 3 * DAY), zip: null }];
  r = await get("zip=72201&type=residential");
  check("suggested tech is the free one, never the booked-solid one", r.body.suggestedTechnicianId === "c", JSON.stringify(r.body.suggestedTechnicianId));
  check("suggestion is always among the offered techs", r.body.technicians.some((t) => t.id === r.body.suggestedTechnicianId));

  // 4b. stacking: the list is ordered by how well each tech's day fits THIS customer
  {
    const CT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23" });
    const parts = (d) => Object.fromEntries(CT.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
    const tmrw = (() => { const p = parts(new Date(Date.now() + DAY)); return { y: p.year, m: p.month, d: p.day }; })();
    const at = (h, m = 0) => { for (const off of [5, 6]) { const c = new Date(Date.UTC(tmrw.y, tmrw.m - 1, tmrw.d, h + off, m)); if (parts(c).hour === h) return c; } };
    const callT = (techId, sh, eh, zip) => ({ techId, start: at(sh), end: at(eh), zip });
    const T2 = (id, name) => ({ id, name, classification: "hybrid", active: true, hcpEmployeeId: `pro_${id}` });
    globalThis.__DB = {
      techs: [T2("A", "Alice Sandwich"), T2("B", "Bob Faraway"), T2("C", "Cara Free"), T2("D", "Dan NextTo"), T2("E", "Eve Booked")],
      appts: [
        callT("A", 9, 10, "72201"), callT("A", 14, 15, "72201"),            // gap 10-14 between two calls in the customer's zip
        callT("B", 9, 10, "72015"), callT("B", 14, 15, "72015"),            // gap between two calls ~70 min away
        callT("D", 9, 18, "72202"),                                         // an opening 8-9 right before a call ~3 min away
        { techId: "E", start: new Date(Date.now() - DAY), end: new Date(Date.now() + 9 * DAY), zip: "72201" },  // booked solid
      ],
    };
    r = await get("zip=72201&type=residential");
    const order = r.body.technicians.map((t) => t.name);
    check("E1 best fit first: on his route (fewest extra minutes), then open days (alphabetical on ties), then no opening", JSON.stringify(order) === JSON.stringify(["Alice Sandwich", "Dan NextTo", "Bob Faraway", "Cara Free", "Eve Booked"]), JSON.stringify(order));
    const byName = (n) => r.body.technicians.find((t) => t.name === n);
    check("E2 Alice's best opening is the gap between her two 72201 calls, tomorrow", byName("Alice Sandwich").bestFit.kind === "between-two" && byName("Alice Sandwich").bestFit.dayLabel === "Tomorrow" && byName("Alice Sandwich").bestFit.prevZip === "72201" && byName("Alice Sandwich").bestFit.nextZip === "72201", JSON.stringify(byName("Alice Sandwich").bestFit));
    check("E2 ... suggested start is right after her earlier call (10:00 CT)", new Date(byName("Alice Sandwich").bestFit.slotStart).getTime() === at(10).getTime(), byName("Alice Sandwich").bestFit.slotStart);
    check("E3 Dan is next-to-one (a near call after his opening)", byName("Dan NextTo").bestFit.kind === "next-to-one" && byName("Dan NextTo").bestFit.nextZip === "72202", JSON.stringify(byName("Dan NextTo").bestFit));
    check("E4 Bob's calls are far away, so his gap between them gets no credit: his best is an open day instead", byName("Bob Faraway").bestFit.kind === "open-day", JSON.stringify(byName("Bob Faraway").bestFit));
    check("E5 a tech with no free time at all has no best fit and no soonest opening", byName("Eve Booked").bestFit === null && byName("Eve Booked").soonest === null);
    check("E6 the suggested tech is the best fit (Alice), not just the soonest", r.body.suggestedTechnicianId === "A", r.body.suggestedTechnicianId);
    check("E7 every tech with an opening reports a soonest time", ["Alice Sandwich", "Dan NextTo", "Bob Faraway", "Cara Free"].every((n) => !!byName(n).soonest));

    // same roster, customer in Benton: Bob's Benton calls now make HIS gap the stack, and the zip changes who is best
    const far = await get("zip=72015&type=residential");
    const farKinds = Object.fromEntries(far.body.technicians.map((t) => [t.name, t.bestFit?.kind ?? null]));
    check("E8 for a customer in Benton (72015), Bob's Benton calls make his the between-two gap", farKinds["Bob Faraway"] === "between-two" && farKinds["Alice Sandwich"] === "open-day", JSON.stringify(farKinds));
    check("E8 ... and he is suggested", far.body.suggestedTechnicianId === "B", far.body.suggestedTechnicianId);
    check("E8b the same five techs are offered in Benton as in Little Rock (zip never filters)", far.body.technicians.length === 5);

    // everyone booked solid -> nobody can be suggested, but they are still listed
    globalThis.__DB.appts = ["A", "B", "C", "D", "E"].map((techId) => ({ techId, start: new Date(Date.now() - DAY), end: new Date(Date.now() + 9 * DAY), zip: "72015" }));
    const none = await get("zip=72015&type=residential");
    check("E9 nobody has time -> list still returned, no suggestion", none.body.technicians.length === 5 && none.body.suggestedTechnicianId === null, JSON.stringify(none.body.suggestedTechnicianId));
  }

  // 4c. addresses: exact map points on the jobs and the customer
  {
    const CT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23" });
    const parts = (d) => Object.fromEntries(CT.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
    const tmrw = (() => { const p = parts(new Date(Date.now() + DAY)); return { y: p.year, m: p.month, d: p.day }; })();
    const at = (h) => { for (const off of [5, 6]) { const c = new Date(Date.UTC(tmrw.y, tmrw.m - 1, tmrw.d, h + off, 0)); if (parts(c).hour === h) return c; } };
    const W = [34.7465, -92.35], M = [34.7465, -92.306], E = [34.7465, -92.262];
    const job = (techId, sh, eh, p) => ({ techId, start: at(sh), end: at(eh), zip: "72201", lat: p[0], lng: p[1] });
    const T3 = (id, name) => ({ id, name, classification: "hybrid", active: true, hcpEmployeeId: `pro_${id}` });
    globalThis.__DB = {
      techs: [T3("P", "Pat Passing"), T3("Q", "Quinn OutAndBack")],
      appts: [
        job("P", 8, 9, W), job("P", 13, 18, E),     // the customer (M) is right on Pat's way from W to E
        job("Q", 8, 9, E), job("Q", 13, 18, E),     // Quinn would drive E -> W(customer) -> E
      ],
    };
    // Fill every other day so neither has an open day to fall back on.
    for (let d = 2; d <= 8; d++) for (const id of ["P", "Q"]) globalThis.__DB.appts.push({ techId: id, start: new Date(at(8).getTime() + (d - 1) * DAY), end: new Date(at(18).getTime() + (d - 1) * DAY), zip: "72015" });
    globalThis.__DB.appts.push({ techId: "P", start: new Date(Date.now() - DAY), end: at(0), zip: "72015" }, { techId: "Q", start: new Date(Date.now() - DAY), end: at(0), zip: "72015" });
    const addr = await get(`lat=${W[0]}&lng=${W[1]}&zip=72201&type=residential`);
    check("A1 address search works with lat/lng", addr.status === 200 && addr.body.technicians.length === 2, JSON.stringify(addr.body).slice(0, 200));
    const mid = await get(`lat=${M[0]}&lng=${M[1]}&zip=72201&type=residential`);
    const pat = mid.body.technicians.find((t) => t.name === "Pat Passing");
    check("A2 customer right on Pat's way: Pat first, between his jobs, ~0 extra minutes", mid.body.technicians[0].name === "Pat Passing" && pat.bestFit.kind === "between-two" && pat.bestFit.route.minutes <= 1, JSON.stringify(pat.bestFit));
    const quinn = mid.body.technicians.find((t) => t.name === "Quinn OutAndBack");
    check("A3 Quinn would drive out and back: more extra minutes than Pat", quinn.bestFit.route.minutes > pat.bestFit.route.minutes, JSON.stringify(quinn.bestFit.route));
    check("A4 the response never carries job map points", !JSON.stringify(mid.body).includes("-92.35"));
    check("A5 lat without lng is rejected", (await get(`lat=34.7&type=residential`)).status === 400);
    check("A6 junk coordinates are rejected", (await get(`lat=abc&lng=-92&type=residential`)).status === 400);
    check("A7 lat/lng without a zip is fine", (await get(`lat=${M[0]}&lng=${M[1]}&type=residential`)).status === 200);
  }

  // 5. input validation still holds
  check("missing type rejected", (await get("zip=72201")).status === 400);
  check("'hybrid' is not a valid CALL type", (await get("zip=72201&type=hybrid")).status === 400);
  check("bad zip rejected", (await get("zip=7220&type=residential")).status === 400);
  check("missing zip rejected", (await get("type=residential")).status === 400);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
