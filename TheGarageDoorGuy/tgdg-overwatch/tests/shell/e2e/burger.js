const { app, BrowserWindow, screen } = require("electron");
const { execFileSync } = require("child_process");
const fs = require("fs");
process.env.OVERWATCH_ADMIN_CHECK_MS = "1500";
app.commandLine.appendSwitch("no-sandbox"); app.commandLine.appendSwitch("disable-gpu"); app.setPath("userData", process.env.TEST_USERDATA);
const SHOTS = process.env.SHOT_DIR || require("os").tmpdir();
const results = []; const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: ok ? "" : String(detail) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const win = () => BrowserWindow.getAllWindows()[0];
const ui = (js) => win().webContents.executeJavaScript(js);
const views = () => win().contentView.children.filter((c) => c.webContents);
const showing = () => views().find((v) => v.getVisible());
const tabs = () => ui(`[...document.querySelectorAll('#tabs .tab')].map(t => ({ id: t.dataset.tool, text: t.textContent, active: t.classList.contains('active') }))`);
const ids = async () => (await tabs()).map((t) => t.id).join(",");
const burger = () => ui("document.getElementById('menu-btn').hidden === false");
const cog = () => ui("document.getElementById('toggle-settings').hidden === false");
const shot = (name) => { try { execFileSync("import", ["-window", "root", `${SHOTS}/${name}-full.png`]); const b = win().getBounds(); execFileSync("convert", [`${SHOTS}/${name}-full.png`, "-crop", `${b.width + 40}x700+${b.x - 20}+0`, "+repage", `${SHOTS}/${name}.png`]); } catch (e) {} };
(async () => {
  const { server } = await require("./stand-in-server.js").start(3000);
  require(require("./ten-tool-app.js").build());
  await app.whenReady(); await wait(3500);

  // ----- signed out: nine tools, no Reports, nothing to open the settings with
  let t = await tabs();
  check("B1 signed out at the standard width: nine tools as one-letter tabs, no Reports, and they all fit so there is no burger", t.length === 9 && !t.some((x) => x.id === "reports") && t.every((x) => x.text.length === 1) && (await burger()) === false, JSON.stringify(t.map((x) => x.id)));
  check("B2 no settings cog while signed out", (await cog()) === false);

  // ----- sign in on the Admin tab
  await ui("document.querySelector('#tabs .tab[data-tool=admin]').click()"); await wait(2800);
  t = await tabs();
  check("B3 signed in: Reports appears in its place in the order (ten tabs), and they still fit at 380", t.length === 10 && t[5].id === "reports" && (await burger()) === false, JSON.stringify(t.map((x) => x.id)));
  check("B4 the cog shows on the Admin screen", (await cog()) === true);

  // ----- the cog is how an admin makes the panel narrow
  await ui("document.getElementById('toggle-settings').click()"); await wait(400);
  await ui("document.querySelector('.preset[data-width=\"320\"]').click()"); await wait(900);
  t = await tabs();
  check("B5 Narrow: ten tools no longer fit, the burger button appears and 7 tabs stay (the active Admin one among them)", (await burger()) === true && t.length === 7 && t.some((x) => x.id === "admin" && x.active), `${t.length} tabs, burger ${await burger()}`);
  await ui("document.getElementById('toggle-settings').click()"); await wait(300);
  shot("b1-narrow");

  await ui("document.getElementById('menu-btn').click()"); await wait(500);
  check("B6 the menu lists ALL ten tools by full name (Reports included, since signed in), the active one marked", (await ui("[...document.querySelectorAll('#menu-panel .menu-row .name')].map(n => n.textContent).join('|')")) === "Dispatch Console|Admin|Job Watch|Estimate Tracker|Inventory|Reports|Fleet|Tools|Training|Notes" && (await ui("document.querySelector('#menu-panel .menu-row.active .name').textContent")) === "Admin");
  check("B7 the menu covers the tool while open, and the button says it is open", showing() === undefined && (await ui("document.getElementById('menu-btn').getAttribute('aria-expanded')")) === "true");
  shot("b2-menu-open");

  await ui("document.querySelector('#menu-panel .menu-row[data-tool=notes]').click()"); await wait(1500);
  t = await tabs();
  check("B8 picking a tool that was behind the burger closes the menu, shows that tool, and keeps its tab visible", (await ui("document.getElementById('menu-panel').hidden")) === true && showing() && showing().webContents.getURL() === "http://localhost:3000/tool-notes" && t.some((x) => x.id === "notes" && x.active) && t.length === 7, JSON.stringify(t.map((x) => x.id)));
  check("B9 off the Admin screen the cog is gone again", (await cog()) === false);
  shot("b3-notes-active");

  await ui("document.getElementById('menu-btn').click()"); await wait(300);
  await ui("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))"); await wait(400);
  check("B10 Escape closes the menu and the tool comes back", (await ui("document.getElementById('menu-panel').hidden")) === true && showing() !== undefined);

  await ui("document.getElementById('menu-btn').click()"); await wait(300);
  await ui("document.querySelector('#menu-panel .menu-row[data-tool=admin]').click()"); await wait(900);
  await ui("document.getElementById('toggle-settings').click()"); await wait(300);
  await ui("document.getElementById('menu-btn').click()"); await wait(300);
  check("B11 the menu and the settings drawer never show at once (opening the menu closes the drawer)", (await ui("document.getElementById('settings').hidden")) === true && (await ui("document.getElementById('menu-panel').hidden")) === false);
  await ui("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))"); await wait(300);

  await ui("document.getElementById('toggle-settings').click()"); await wait(300);
  check("B12 the Tabs section offers the seven hideable tools, but not Dispatch, Admin or Reports", (await ui("[...document.querySelectorAll('#tab-toggles input')].map(i => i.dataset.tool).join()")) === "jobwatch,estimates,inventory,fleet,tools,training,notes");
  await ui("document.querySelector('.preset[data-width=\"520\"]').click()"); await wait(900);
  t = await tabs();
  check("B13 at Wide all ten fit and the burger disappears", t.length === 10 && (await burger()) === false, `${t.length}`);
  shot("b4-wide-ten");
  await ui("document.querySelector('.preset[data-width=\"320\"]').click()"); await wait(900);
  check("B14 back to Narrow, the burger returns", (await burger()) === true);

  await ui("document.querySelector('#tab-toggles input[data-tool=training]').click()"); await wait(500);
  await ui("document.getElementById('toggle-settings').click()"); await wait(300);
  await ui("document.getElementById('menu-btn').click()"); await wait(300);
  check("B15 a hidden tool is gone from the menu too (nine left)", (await ui("document.querySelectorAll('#menu-panel .menu-row').length")) === 9);
  await ui("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))"); await wait(200);

  // ----- signing out: Reports leaves the menu as well
  await ui("document.querySelector('#menu-btn').click()"); await wait(200);
  await ui("document.querySelector('#menu-panel .menu-row[data-tool=reports]').click()"); await wait(1500);
  const rv = showing();
  await rv.webContents.executeJavaScript("fetch('/logout')"); await wait(3000);
  await ui("document.getElementById('menu-btn').click()"); await wait(300);
  check("B16 after signing out Reports is gone from the menu too (eight left), and the panel moved off it", (await ui("[...document.querySelectorAll('#menu-panel .menu-row .name')].map(n => n.textContent).join('|')")) === "Dispatch Console|Admin|Job Watch|Estimate Tracker|Inventory|Fleet|Tools|Notes" && showing() === undefined, await ui("[...document.querySelectorAll('#menu-panel .menu-row .name')].map(n => n.textContent).join('|')"));
  server.close();
  fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify(results, null, 1)); app.exit(0);
})().catch((e) => { results.push({ name: "CRASH", ok: false, detail: e.stack || String(e) }); fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify(results, null, 1)); app.exit(2); });
