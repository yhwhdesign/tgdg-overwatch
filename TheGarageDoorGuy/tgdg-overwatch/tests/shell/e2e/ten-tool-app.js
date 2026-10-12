// Builds a throwaway copy of the panel whose tool registry has ten tools, so the burger menu can be tested
// for real. Nothing in the real app is changed; the copy lives in the system temp folder.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REGISTRY = `(function (root, factory) { const api = factory(); if (typeof module === "object" && module.exports) module.exports = api; else { root.ToolsRegistry = api; root.TOOLS = api.TOOLS; } })(typeof self !== "undefined" ? self : this, function () {
  const rows = [["dispatch", "Dispatch Console", "Dispatch", "D", "/", { core: true }], ["admin", "Admin", "Admin", "A", "/admin", { core: true, hostsPanelSettings: true }], ["jobwatch", "Job Watch", "Job Watch", "J", "/tool-jobwatch", {}], ["estimates", "Estimate Tracker", "Estimates", "E", "/tool-estimates", {}], ["inventory", "Inventory", "Inventory", "I", "/tool-inventory", {}], ["reports", "Reports", "Reports", "R", "/reports", { adminOnly: true }], ["fleet", "Fleet", "Fleet", "F", "/tool-fleet", {}], ["tools", "Tools", "Tools", "T", "/tool-tools", {}], ["training", "Training", "Training", "G", "/tool-training", {}], ["notes", "Notes", "Notes", "N", "/tool-notes", {}]];
  return { TOOLS: rows.map(([id, name, shortName, glyph, p, flags]) => ({ id, name, shortName, glyph, path: p, ...flags })) };
});
`;

/** Copies src/ to a temp folder, swaps in the ten-tool registry, and returns the path of that copy's main.js. */
function build() {
  const target = path.join(os.tmpdir(), "overwatch-ten-tools");
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(__dirname, "../../../src"), path.join(target, "src"), { recursive: true });
  fs.copyFileSync(path.join(__dirname, "../../../package.json"), path.join(target, "package.json"));
  fs.writeFileSync(path.join(target, "src", "tools.js"), REGISTRY);
  return path.join(target, "src", "main.js");
}

module.exports = { build };
