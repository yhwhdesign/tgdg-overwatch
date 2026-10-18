import { itemsFromWatch, runNotify, eligible, parseKinds, cleanName, newTopic, validTopic, NoDeviceError, MAX_LAG_MS, NOTIFY_KINDS, type NotifyStore, type Recipient, type Sender, type NotifyItem, type NotifyMessage } from "../../src/lib/notify.ts";

let passes = 0, failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
const eq = (name: string, a: unknown, b: unknown) => check(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const NOW = new Date("2026-10-19T15:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const URL1 = "https://pro.housecallpro.com/app/estimates/csr_1";
const ALL = [...NOTIFY_KINDS];
const person = (o: Partial<Recipient> = {}): Recipient => ({ id: "r1", name: "Jasen", topic: "tgdg-" + "a".repeat(24), kinds: ALL, enabled: true, createdAt: new Date(NOW.getTime() - 86_400_000), ...o });
const memStore = (people: Recipient[]) => {
  const claimed = new Set<string>(); let pruned: Date | null = null;
  const store: NotifyStore & { claimed: Set<string>; pruned: () => Date | null } = {
    claimed, pruned: () => pruned,
    async listRecipients() { return people; },
    async claim(key) { if (claimed.has(key)) return false; claimed.add(key); return true; },
    async release(key) { claimed.delete(key); },
    async prune(d) { pruned = d; },
  };
  return store;
};
const memSender = (failFor: string[] = []) => {
  const sent: { to: string; m: NotifyMessage }[] = [];
  const s: Sender & { sent: typeof sent } = { sent, async send(r, m) { if (failFor.includes(r.name)) throw new Error("boom"); sent.push({ to: r.name, m }); } };
  return s;
};

const watch = {
  alerts: [
    { id: "job_1@120", kind: "install", label: "Garage Door Install #4521", techs: ["Alex Tech", "Blake Tech"], startedAt: ago(130), startedLabel: "7:50 AM", minutesOnJob: 130, limitMinutes: 120, url: "https://pro.housecallpro.com/app/jobs/job_1" },
    { id: "csr_2@3d", kind: "estimate", label: "Estimate #8802 ($990)", techs: ["Blake Tech"], startedAt: ago(3 * 1440 + 60), startedLabel: "Oct 16", minutesOnJob: 3 * 1440 + 60, limitMinutes: 3 * 1440, url: URL1 },
  ],
  completed: [
    { id: "csr_1#99", kind: "estimate", label: "Estimate #8801", techs: ["Alex Tech"], completedAt: ago(5), completedLabel: "9:55 AM", minutesOnJob: 35, notes: ["Steel Back: $1,500", "Vinyl Back: $1,800"], url: URL1 },
    { id: "job_2#88", kind: "service", label: "Service call #4600", techs: ["Alex Tech"], completedAt: ago(8), completedLabel: "9:52 AM", minutesOnJob: 65, notes: ["gate code 4471", "Zelda Quimby wants a call"], url: "https://pro.housecallpro.com/app/jobs/job_2" },
  ],
};
const items = itemsFromWatch(watch);
const byId = (id: string) => items.find((i) => i.id === id)!;

// ===== A. turning findings into messages
eq("A1 four items, one of each kind", items.map((i) => i.kind).sort(), [...ALL].sort());
let m = byId("job_1@120");
eq("A2 over-time job: who, what, how long, the normal limit; high priority; links to the job", [m.message.title, m.message.body, m.message.priority, m.message.url], ["Job running long", 'Alex Tech and Blake Tech have been on "Garage Door Install #4521" for 2h 10m (normal is 2h). Started 7:50 AM.', 4, "https://pro.housecallpro.com/app/jobs/job_1"]);
eq("A3 its event time is when it crossed the limit", m.eventAt, Date.parse(ago(130)) + 120 * 60_000);
m = byId("csr_2@3d");
eq("A4 waiting estimate", [m.message.title, m.message.body], ["Estimate waiting", 'Estimate #8802 ($990) has had no answer for 3 days. Created Oct 16 (Blake Tech). No option is approved or declined yet.']);
eq("A5 its event time is when it became due (created + 3 days)", m.eventAt, Date.parse(ago(3 * 1440 + 60)) + 3 * 1440 * 60_000);
m = byId("csr_1#99");
eq("A6 finished estimate: includes the options and amounts", [m.message.title, m.message.body], ["Estimate finished", 'Alex Tech finished "Estimate #8801" at 9:55 AM after 35m.\nSteel Back: $1,500\nVinyl Back: $1,800']);
m = byId("job_2#88");
eq("A7 finished JOB: the notes are NEVER included", [m.message.title, m.message.body.includes("4471"), m.message.body.includes("Zelda"), m.message.body.endsWith("Open the job to read the notes.")], ["Job finished", false, false, true]);
check("A8 no message holds a customer name, address or phone", !JSON.stringify(items).includes("Quimby") && !JSON.stringify(items).includes("4471"));
eq("A9 junk entries are skipped, never crash", itemsFromWatch({ alerts: [null, 5, {}, { id: "x" }, { id: "y", startedAt: "junk" }], completed: ["s", {}, { id: "z", completedAt: "nope" }] } as never).length, 0);
eq("A10 an unsafe or off-site link is dropped, the message still goes", itemsFromWatch({ alerts: [{ ...watch.alerts[1], url: "https://evil.com/x" }, { ...watch.alerts[0], url: "javascript:alert(1)" }] }).map((i) => i.message.url), [null, null]);
eq("A11 no techs: 'A technician'", itemsFromWatch({ completed: [{ ...watch.completed[1], techs: [] }] })[0].message.body.startsWith('A technician finished'), true);
eq("A12 singular day", itemsFromWatch({ alerts: [{ ...watch.alerts[1], minutesOnJob: 1440 + 30 }] })[0].message.body.includes("no answer for 1 day."), true);
check("A13 titles are plain ASCII (they travel in a header)", items.every((i) => /^[\x20-\x7e]+$/.test(i.message.title)));

// ===== B. who is eligible
const item = (o: Partial<NotifyItem> = {}): NotifyItem => ({ id: "e1", kind: "estimate-finished", eventAt: NOW.getTime() - 60_000, message: items[0].message, ...o });
const t = NOW.getTime();
eq("B1 enabled + chosen kind + new enough = yes", eligible(item(), person(), t), true);
eq("B2 switched off = no", eligible(item(), person({ enabled: false }), t), false);
eq("B3 a kind they did not choose = no", eligible(item(), person({ kinds: ["job-over"] }), t), false);
eq("B4 news from BEFORE they were added = no", eligible(item({ eventAt: t - 2 * 86_400_000 }), person(), t), false);
eq("B5 older than 12 hours = no, just inside = yes", [eligible(item({ eventAt: t - MAX_LAG_MS - 1 }), person({ createdAt: new Date(0) }), t), eligible(item({ eventAt: t - MAX_LAG_MS + 1000 }), person({ createdAt: new Date(0) }), t)], [false, true]);
eq("B6 far in the future (clock oddity) = no", eligible(item({ eventAt: t + 3_600_000 }), person(), t), false);
eq("B7 no kinds chosen = no", eligible(item(), person({ kinds: [] }), t), false);

// ===== C. running it
let store = memStore([person()]); let sender = memSender();
let r = await runNotify({ items, store, sender, now: () => NOW });
eq("C1 one person who chose everything is told about all four", [r.sent, r.failed, r.alreadySent, sender.sent.length], [4, 0, 0, 4]);
r = await runNotify({ items, store, sender, now: () => NOW });
eq("C2 running again tells nobody twice", [r.sent, r.alreadySent, sender.sent.length], [0, 4, 4]);
store = memStore([person(), person({ id: "r2", name: "Dispatch", kinds: ["estimate-finished"] })]); sender = memSender();
r = await runNotify({ items, store, sender, now: () => NOW });
eq("C3 each person gets only what they chose", [sender.sent.filter((s) => s.to === "Jasen").length, sender.sent.filter((s) => s.to === "Dispatch").map((s) => s.m.title)], [4, ["Estimate finished"]]);
store = memStore([person({ createdAt: new Date(NOW.getTime() - 3 * 60_000) })]); sender = memSender();
r = await runNotify({ items, store, sender, now: () => NOW });
eq("C4 someone added 3 minutes ago is not sent older news (only the 2 events since)", sender.sent.length, 0);
store = memStore([person(), person({ id: "r2", name: "Dispatch" })]); sender = memSender(["Dispatch"]);
r = await runNotify({ items, store, sender, now: () => NOW, log: () => {} });
eq("C5 one person's failed send does not stop the others, and is counted", [r.sent, r.failed], [4, 4]);
eq("C6 a failed send is un-recorded so the next run tries again", [...store.claimed].filter((k) => k.startsWith("r2|")).length, 0);
sender = memSender();
r = await runNotify({ items, store, sender, now: () => NOW });
eq("C7 ...and the next run delivers it", [r.sent, sender.sent.every((s) => s.to === "Dispatch")], [4, true]);
store = memStore([person({ enabled: false })]); sender = memSender();
r = await runNotify({ items, store, sender, now: () => NOW });
eq("C8 a switched-off person is skipped entirely", [r.recipients, r.sent], [0, 0]);
store = memStore([]);
r = await runNotify({ items, store, sender, now: () => NOW });
eq("C9 an empty list does nothing (and still tidies old records)", [r.recipients, r.sent, store.pruned() !== null], [0, 0, true]);
eq("C10 records older than 3 days are pruned", store.pruned()!.getTime(), NOW.getTime() - 3 * 86_400_000);
store = memStore([person()]); sender = memSender();
const dup = [items[0], items[0]];
r = await runNotify({ items: dup, store, sender, now: () => NOW });
eq("C11 the same event twice in one run is sent once", sender.sent.length, 1);

// ===== D. the people list
eq("D1 kinds: valid, duplicates removed", parseKinds(["job-over", "job-over", "job-finished"]), ["job-over", "job-finished"]);
eq("D2 kinds: unknown or non-list = null", [parseKinds(["bogus"]), parseKinds("job-over"), parseKinds(null), parseKinds([5])], [null, null, null, null]);
eq("D3 kinds: empty list is fine", parseKinds([]), []);
eq("D4 names are tidied; empty / too long / not text = null", [cleanName("  Jasen   B  "), cleanName(""), cleanName("   "), cleanName("x".repeat(61)), cleanName(5), cleanName(null)], ["Jasen B", null, null, null, null, null]);
const topics = new Set(Array.from({ length: 200 }, () => newTopic()));
check("D5 topics are unique, valid, and long enough to be unguessable", topics.size === 200 && [...topics].every((x) => validTopic(x) && x.length >= 29), [...topics][0]);
eq("D6 invalid topics are refused", ["", "short", "a/b", "x".repeat(65), "has space 1234567890123456", 5, null].map(validTopic), Array(7).fill(false));

// ===== E. a person with no phone connected yet
const holdSender = (noDevice: string[]) => {
  const sent: string[] = [];
  const s: Sender & { sent: string[] } = { sent, async send(r) { if (noDevice.includes(r.name)) throw new NoDeviceError(); sent.push(r.name); } };
  return s;
};
{
  const store = memStore([person(), person({ id: "r2", name: "Dispatch" })]); const sender = holdSender(["Dispatch"]);
  const logs: string[] = [];
  let res = await runNotify({ items, store, sender, now: () => NOW, log: (m) => logs.push(m) });
  eq("E1 someone with no phone is not a failure: counted as held back, never as failed, nothing logged", [res.sent, res.failed, res.noDevice, logs.length], [4, 0, 4, 0]);
  eq("E2 their events are not recorded as sent, so they are delivered once a phone is connected", [...store.claimed].filter((k) => k.startsWith("r2|")).length, 0);
  const later = holdSender([]);
  res = await runNotify({ items, store, sender: later, now: () => NOW });
  eq("E3 ...and the next run delivers them once a phone is connected", [res.sent, res.alreadySent, later.sent.filter((n) => n === "Dispatch").length], [4, 4, 4]);
  eq("E4 NoDeviceError is its own kind of error", [new NoDeviceError() instanceof Error, new NoDeviceError().name], [true, "NoDeviceError"]);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
