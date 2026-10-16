import { dockGeometry, dockFeatures, dockMode, DOCK_WINDOW_NAME } from "../../src/lib/dock-window.ts";
let passes = 0, failures = 0;
const eq = (n: string, a: unknown, b: unknown) => { if (JSON.stringify(a) === JSON.stringify(b)) passes++; else { failures++; console.log(`FAIL ${n}\n   got  ${JSON.stringify(a)}\n   want ${JSON.stringify(b)}`); } };

// ---- where the window goes
eq("D1 a 1920x1080 screen: 380 wide, full height, against the right edge", dockGeometry({ availWidth: 1920, availHeight: 1040 }), { left: 1540, top: 0, width: 380, height: 1040 });
eq("D2 a second screen to the right (starts at x=1920): stays on THAT screen's right edge", dockGeometry({ availLeft: 1920, availTop: 0, availWidth: 2560, availHeight: 1400 }), { left: 4100, top: 0, width: 380, height: 1400 });
eq("D3 a screen to the left of the main one (negative start): still its own right edge", dockGeometry({ availLeft: -1440, availTop: 25, availWidth: 1440, availHeight: 875 }), { left: -380, top: 25, width: 380, height: 875 });
eq("D4 a menu bar at the top is respected (availTop)", dockGeometry({ availLeft: 0, availTop: 38, availWidth: 1512, availHeight: 944 }).top, 38);
eq("D5 a dock/taskbar on the left shifts the right edge correctly", dockGeometry({ availLeft: 70, availTop: 0, availWidth: 1850, availHeight: 1080 }).left, 1540);
eq("D6 a width that is too small is raised to 320", dockGeometry({ availWidth: 1920, availHeight: 1000 }, 100).width, 320);
eq("D7 a width that is too large is lowered to 520", dockGeometry({ availWidth: 1920, availHeight: 1000 }, 2000).width, 520);
eq("D8 a tiny screen never gives a window wider than the screen", dockGeometry({ availWidth: 300, availHeight: 600 }).width, 300);
eq("D9 missing/NaN screen numbers fall back to a sane window, not NaN", dockGeometry({ availWidth: NaN, availHeight: undefined as unknown as number, availLeft: NaN }), { left: 900, top: 0, width: 380, height: 800 });
eq("D10 a NaN width falls back to the default", dockGeometry({ availWidth: 1000, availHeight: 800 }, NaN).width, 380);
const g = dockGeometry({ availWidth: 1920, availHeight: 1040 });
eq("D11 the window.open features text", dockFeatures(g), "popup=yes,left=1540,top=0,width=380,height=1040");
eq("D12 the window's right edge lands exactly on the screen's right edge", g.left + g.width, 1920);

// ---- when the button shows
const chrome = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Safari/537.36";
eq("M1 an ordinary browser tab: Dock", dockMode({ userAgent: chrome, windowName: "", standalone: false }), "dock");
eq("M2 inside the desktop panel (Electron): no button, it docks itself", dockMode({ userAgent: chrome + " Electron/44.5.1", windowName: "", standalone: false }), "hidden");
eq("M3 the docked window we opened: Re-dock", dockMode({ userAgent: chrome, windowName: DOCK_WINDOW_NAME, standalone: false }), "redock");
eq("M4 an installed app window: no button", dockMode({ userAgent: chrome, windowName: "", standalone: true }), "hidden");
eq("M5 inside Electron wins even if the window has our name", dockMode({ userAgent: chrome + " Electron/44.5.1", windowName: DOCK_WINDOW_NAME, standalone: false }), "hidden");
eq("M6 a window with some other name: Dock", dockMode({ userAgent: chrome, windowName: "something-else", standalone: false }), "dock");

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
