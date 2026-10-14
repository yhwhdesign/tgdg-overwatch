// Runs the panel's end-to-end tests against the REAL app (src/main.js) with a small stand-in for the console.
//   npm run test:e2e
// Needs Electron installed (npm install in this folder) and port 3000 FREE (stop `npm run dev` first).
// On Linux/CI without a screen it uses xvfb-run automatically. On a Mac or Windows PC it opens real windows on your
// screen for about a minute: that is normal, and you should not touch the mouse while it runs.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let electron;
try {
  electron = require("electron");
} catch {
  console.error("Electron is not installed. Run `npm install` in the top folder of the repo first.");
  process.exit(2);
}

const portFree = await new Promise((resolve) => {
  const probe = net.createServer();
  probe.once("error", () => resolve(false));
  probe.listen(3000, "127.0.0.1", () => probe.close(() => resolve(true)));
});
if (!portFree) {
  console.error("Port 3000 is in use (probably `npm run dev`). Stop it first: the test stands in for the console on that port.");
  process.exit(2);
}

const headless = !process.env.DISPLAY && process.platform === "linux" && spawnSync("which", ["xvfb-run"]).status === 0;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "overwatch-e2e-"));
const shots = path.join(work, "screenshots");
fs.mkdirSync(shots);

function launch(script, env) {
  const flags = ["--no-sandbox", "--disable-gpu", path.join(here, script)];
  const options = { env: { ...process.env, SHOT_DIR: shots, SUITE_TRACE: "1", ...env }, encoding: "utf8", timeout: 240_000 };
  return headless
    ? spawnSync("xvfb-run", ["-a", "-s", "-screen 0 1920x1080x24", electron, ...flags], options)
    : spawnSync(electron, flags, options);
}

const dir = (name) => {
  const d = path.join(work, name);
  fs.mkdirSync(d);
  return d;
};
const runs = [];
const settingsA = dir("settings-a");
runs.push({ label: "full walk-through", script: "suite.js", env: { PHASE: "1", TEST_USERDATA: settingsA } });
runs.push({ label: "restart with the same settings", script: "suite.js", env: { PHASE: "2", TEST_USERDATA: settingsA } });
const settingsB = dir("settings-b");
fs.writeFileSync(path.join(settingsB, "overwatch-store.json"), JSON.stringify({ dispatch: "http://localhost:3000" }));
runs.push({ label: "old-format settings file", script: "suite.js", env: { PHASE: "3", TEST_USERDATA: settingsB } });
runs.push({ label: "burger menu with ten tools", script: "burger.js", env: { TEST_USERDATA: dir("settings-c") } });

let passed = 0;
let failed = 0;
for (const [i, run] of runs.entries()) {
  const resultFile = path.join(work, `result-${i}.json`);
  const out = launch(run.script, { ...run.env, RESULT_FILE: resultFile });
  let results;
  try {
    results = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  } catch {
    const traced = (out.stdout || "").split("\n").filter((l) => /^(ok  |FAIL) /.test(l));
    console.log(`FAIL [${run.label}] produced no result (exit ${out.status}${out.signal ? `, killed by ${out.signal}: it got stuck` : ""})`);
    console.log(`   last step that finished: ${traced.length ? traced[traced.length - 1] : "(none: it never got going)"}`);
    console.log((out.stderr || "").split("\n").filter((l) => !/dbus|ERROR:/.test(l) && l.trim()).slice(-6).join("\n"));
    failed += 1;
    continue;
  }
  const bad = results.filter((r) => !r.ok);
  passed += results.length - bad.length;
  failed += bad.length;
  console.log(`${bad.length === 0 ? "PASS" : "FAIL"} [${run.label}] ${results.length - bad.length} of ${results.length} checks`);
  for (const b of bad) console.log(`   FAIL ${b.name}  <- ${b.detail}`);
}
console.log(`\n${passed} passed, ${failed} failed   (screenshots, if ImageMagick is installed: ${shots})`);
process.exit(failed ? 1 : 0);
