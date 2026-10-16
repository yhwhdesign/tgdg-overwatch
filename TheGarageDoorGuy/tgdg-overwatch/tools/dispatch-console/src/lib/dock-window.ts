// "Dock" for a browser window: a web page cannot move or resize the browser window you opened it in, but it CAN open
// a new narrow window and place that one at the right edge of the screen. These are the decisions, kept apart from
// the page so they can be tested without a browser.

export const DOCK_WINDOW_NAME = "overwatch-dock";
export const DOCK_DEFAULT_WIDTH = 380; // the same as the desktop panel's "Standard" width
const MIN_WIDTH = 320;
const MAX_WIDTH = 520;

export interface ScreenLike {
  /** Where the usable screen area starts (not every browser reports these; 0 is assumed). */
  availLeft?: number;
  availTop?: number;
  availWidth: number;
  availHeight: number;
}

export interface DockGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The window's place: full height of the usable screen, against its right edge. */
export function dockGeometry(screen: ScreenLike, width: number = DOCK_DEFAULT_WIDTH): DockGeometry {
  const availWidth = Number.isFinite(screen.availWidth) && screen.availWidth > 0 ? screen.availWidth : 1280;
  const availHeight = Number.isFinite(screen.availHeight) && screen.availHeight > 0 ? screen.availHeight : 800;
  const left0 = Number.isFinite(screen.availLeft) ? (screen.availLeft as number) : 0;
  const top0 = Number.isFinite(screen.availTop) ? (screen.availTop as number) : 0;
  const wanted = Number.isFinite(width) ? width : DOCK_DEFAULT_WIDTH;
  const w = Math.round(Math.min(Math.max(wanted, MIN_WIDTH), MAX_WIDTH, availWidth));
  return { left: Math.round(left0 + availWidth - w), top: Math.round(top0), width: w, height: Math.round(availHeight) };
}

/** The text for window.open's third argument. */
export function dockFeatures(g: DockGeometry): string {
  return `popup=yes,left=${g.left},top=${g.top},width=${g.width},height=${g.height}`;
}

export type DockMode = "hidden" | "dock" | "redock";

/**
 * What the button should do here.
 *  - inside the desktop panel (it already docks itself), or in an installed app window: no button
 *  - inside the docked window we opened: "redock" (put it back after it was dragged)
 *  - in an ordinary browser tab: "dock"
 */
export function dockMode(env: { userAgent: string; windowName: string; standalone: boolean }): DockMode {
  if (/Electron\//i.test(env.userAgent)) return "hidden";
  if (env.windowName === DOCK_WINDOW_NAME) return "redock";
  if (env.standalone) return "hidden";
  return "dock";
}
