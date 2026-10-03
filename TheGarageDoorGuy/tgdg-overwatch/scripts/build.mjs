// Zero-dependency build: copies src/ into dist/chrome and dist/firefox,
// overlaying the right manifest.json for each. No bundler, no npm installs
// beyond what's already in the repo — keeps this maintainable by hand.
import { cpSync, rmSync, mkdirSync, copyFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "src");
const manifests = join(root, "manifests");

const targets = [
  { name: "chrome", manifest: "chrome.manifest.json", exclude: [] },
  // Firefox's sidebar_action needs no background script at all.
  { name: "firefox", manifest: "firefox.manifest.json", exclude: ["background-chrome.js"] },
];

for (const target of targets) {
  const outDir = join(root, "dist", target.name);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(src, outDir, { recursive: true });
  for (const file of target.exclude) {
    unlinkSync(join(outDir, file));
  }
  copyFileSync(join(manifests, target.manifest), join(outDir, "manifest.json"));
  console.log(`Built dist/${target.name}`);
}
