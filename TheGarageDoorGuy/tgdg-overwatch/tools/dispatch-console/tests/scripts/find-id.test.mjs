import http from "node:http";
import { spawn } from "node:child_process";
let passes = 0, failures = 0;
const check = (n, ok, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };

const SECRETS = ["Zelda", "Quimby", "Evergreen", "4471", "501-555-0142", "zelda@example.com"];
const hex = (n) => String(n).padStart(32, "0");
const TARGET = "est_" + hex(77);
const est = (n, optId) => ({
  id: "csr_" + hex(n), estimate_number: 8800 + n, work_status: "scheduled",
  customer: { first_name: "Zelda", last_name: "Quimby", email: "zelda@example.com", mobile_number: "501-555-0142" },
  address: { street: "742 Evergreen Terrace" }, notes: [{ content: "gate code 4471" }],
  options: [{ id: optId, approval_status: "approved", total_amount: 1000 }],
});
const page1 = Array.from({ length: 3 }, (_, i) => est(i + 1, "est_" + hex(i + 1)));
const page2 = [est(10, TARGET), est(11, "est_" + hex(11))];

const seen = []; const methods = [];
function startHcp(port, { direct = 200, status = 200 } = {}) {
  const s = http.createServer((req, res) => {
    methods.push(req.method); const u = new URL(req.url, "http://x"); seen.push(u.pathname + u.search);
    const send = (c, b) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (u.pathname === "/estimates") {
      if (status !== 200) return send(status, { error: "<secret Zelda>" });
      const p = Number(u.searchParams.get("page"));
      return send(200, { page: p, total_pages: 2, estimates: p === 1 ? page1 : page2 });
    }
    if (u.pathname === "/estimates/" + TARGET) return direct === 200 ? send(200, { id: "csr_" + hex(10), options: [{ id: TARGET }], customer: { first_name: "Zelda" } }) : send(direct, {});
    send(404, {});
  });
  return new Promise((r) => s.listen(port, () => r(s)));
}
const run = (port, args = [], env = {}) => new Promise((resolve) => {
  const p = spawn("node", ["scripts/hcp-find-id.mjs", ...args], { cwd: new URL("../..", import.meta.url).pathname, env: { ...process.env, HCP_BASE_URL: `http://localhost:${port}`, HCP_API_KEY: "test-key", ...env } });
  let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  const timer = setTimeout(() => p.kill(), 30000);
  p.on("close", (code) => { clearTimeout(timer); resolve({ out, code }); });
});

let hcp = await startHcp(4321);
let r = await run(4321, [`https://pro.housecallpro.com/app/estimates/${TARGET}`]);
check("1 it finds the id from a full web address and says which field holds it", r.code === 0 && /FOUND/.test(r.out) && /options\[\]\.id/.test(r.out), r.out);
check("2 it keeps reading pages until it finds it (page 2) and stops there", seen.some((s) => s.includes("page=2")) && /Estimates read: 5/.test(r.out), r.out);
check("3 the summary shows the estimate's own id starts with csr_ and the options' ids with est_", /csr_/.test(r.out) && /options\[\]\.id starts with est_/.test(r.out) && /\(top\)|^\s+\d+x\s+id starts with csr_/m.test(r.out), r.out);
check("4 the direct lookup is reported", /directly: 200/.test(r.out));
check("5 only GET requests were made", methods.every((m) => m === "GET"), methods.join());
check("6 nothing private is printed", !SECRETS.some((s) => r.out.includes(s)), r.out);
check("7 ids are shortened, never printed in full", !r.out.includes(hex(77)) && !r.out.includes(hex(1)), r.out);

r = await run(4321, [TARGET.replace("77", "99"), "1"]);
check("8 an id that is not in the sample says so, still shows the id fields and exits cleanly", r.code === 0 && /NOT among them/.test(r.out) && /options\[\]\.id starts with est_/.test(r.out), r.out);
r = await run(4321, [TARGET, "1"]);
check("9 with a 1-page limit it reads only one page", /Estimates read: 3/.test(r.out) && /NOT among them/.test(r.out) && /directly: 200/.test(r.out), r.out);
for (const bad of [[], ["not an id"], [TARGET, "0"], [TARGET, "141"], [TARGET, "x"], [TARGET, "2", "extra"]]) { r = await run(4321, bad); check(`10 bad arguments ${JSON.stringify(bad)} print usage and exit 1`, r.code === 1 && /Usage/.test(r.out)); }
r = await run(4321, [TARGET], { HCP_API_KEY: "" });
check("11 an empty key is explained", r.code === 1 && /HCP_API_KEY is empty/.test(r.out));
hcp.close();

hcp = await startHcp(4322, { status: 403 });
r = await run(4322, [TARGET]);
check("12 a refused key is explained without the server's text", r.code === 1 && /403/.test(r.out) && !/Zelda/.test(r.out), r.out);
hcp.close();
hcp = await startHcp(4323, { direct: 404 });
r = await run(4323, [TARGET]);
check("13 a direct lookup that fails (404) is just reported", r.code === 0 && /directly: 404/.test(r.out), r.out);
hcp.close();

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
