// The Dock button in a browser window, run for real (jsdom) with a stand-in for the browser's window.open.
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const path = require("path");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
(async () => {
  const out = await esbuild.build({ entryPoints: [path.join(__dirname, "../../src/app/DockButton.tsx")], bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", alias: { "@": path.join(__dirname, "../../src") }, nodePaths: [path.join(__dirname, "../../node_modules")], external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"], logLevel: "silent" });
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost:3000/", pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event });
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = React;
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  const DockButton = mod.exports.default;
  const root = createRoot(document.getElementById("root"));

  const CHROME = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Safari/537.36";
  const setup = ({ ua = CHROME, name = "", standalone = false, open } = {}) => {
    const calls = { open: [], selfResize: [], selfMove: [] };
    Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
    window.name = name;
    Object.defineProperty(window.screen, "availWidth", { value: 1920, configurable: true });
    Object.defineProperty(window.screen, "availHeight", { value: 1040, configurable: true });
    Object.defineProperty(window.screen, "availLeft", { value: 0, configurable: true });
    Object.defineProperty(window.screen, "availTop", { value: 0, configurable: true });
    window.matchMedia = () => ({ matches: standalone });
    window.open = (...args) => { calls.open.push(args); return open ? open(args) : null; };
    window.resizeTo = (w, h) => calls.selfResize.push([w, h]);
    window.moveTo = (x, y) => calls.selfMove.push([x, y]);
    return calls;
  };
  const mount = async () => { await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(DockButton))); }); await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
  const button = () => document.querySelector("button");
  const note = () => (document.querySelector("[role=status]") || {}).textContent || "";
  const click = async () => { await act(async () => { button().dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); };

  // B1 an ordinary tab
  let fakeWin;
  let calls = setup({ open: () => (fakeWin = { resized: [], moved: [], focused: 0, resizeTo(w, h) { this.resized.push([w, h]); }, moveTo(x, y) { this.moved.push([x, y]); }, focus() { this.focused++; } }) });
  await mount();
  check("B1 a normal browser tab shows a 'Dock' button", !!button() && button().textContent === "Dock", document.body.innerHTML);
  await click();
  check("B2 clicking opens ONE window, for this same page, under the dock name", calls.open.length === 1 && calls.open[0][0] === "http://localhost:3000/" && calls.open[0][1] === "overwatch-dock", JSON.stringify(calls.open));
  check("B3 asked for a pop-up window 380 wide, full height, against the right edge (1920-380=1540)", calls.open[0][2] === "popup=yes,left=1540,top=0,width=380,height=1040", calls.open[0][2]);
  check("B4 it also places the new window explicitly (browsers that ignore left/top in the features)", JSON.stringify(fakeWin.resized) === "[[380,1040]]" && JSON.stringify(fakeWin.moved) === "[[1540,0]]" && fakeWin.focused === 1, JSON.stringify(fakeWin));
  check("B5 it says so, and that this tab can be closed", /Docked in the side window/.test(note()) && /close this tab/.test(note()), note());
  check("B6 the original tab itself is not moved or resized (a page cannot, and must not try)", calls.selfResize.length === 0 && calls.selfMove.length === 0);

  // B7 pop-up blocked
  calls = setup({ open: () => null });
  await mount();
  await click();
  check("B7 a blocked pop-up: a plain explanation, no crash", /blocked the pop-up/.test(note()) && /Allow pop-ups/.test(note()), note());

  // B8 the browser refuses to move the new window
  calls = setup({ open: () => ({ resizeTo() { throw new Error("no"); }, moveTo() { throw new Error("no"); }, focus() {} }) });
  await mount();
  await click();
  check("B8 a browser that refuses resizeTo/moveTo does not break the button (the features already placed it)", /Docked in the side window/.test(note()), note());

  // B9 inside the docked window
  calls = setup({ name: "overwatch-dock" });
  await mount();
  check("B9 inside the docked window the button reads 'Re-dock'", button() && button().textContent === "Re-dock");
  await click();
  check("B10 Re-dock moves THIS window back to the edge and opens nothing", calls.open.length === 0 && JSON.stringify(calls.selfResize) === "[[380,1040]]" && JSON.stringify(calls.selfMove) === "[[1540,0]]", JSON.stringify(calls));

  // B11 the desktop panel / an installed app
  calls = setup({ ua: CHROME + " Electron/44.5.1" });
  await mount();
  check("B11 inside the desktop panel there is no button (it docks itself)", button() === null);
  calls = setup({ standalone: true });
  await mount();
  check("B12 in an installed app window there is no button", button() === null);

  // B13 a second screen
  calls = setup({ open: () => ({ resizeTo() {}, moveTo() {}, focus() {} }) });
  Object.defineProperty(window.screen, "availLeft", { value: 1920, configurable: true });
  Object.defineProperty(window.screen, "availWidth", { value: 2560, configurable: true });
  await mount();
  await click();
  check("B13 on a second screen it docks to THAT screen's right edge (1920+2560-380=4100)", /left=4100,/.test(calls.open[0][2]), calls.open[0][2]);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
