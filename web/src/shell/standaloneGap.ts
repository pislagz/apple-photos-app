/**
 * #407: iOS home-screen (standalone) apps with a black-translucent status bar
 * get a layout viewport that is short by roughly the status-bar height, so
 * every `position: fixed; inset: 0` surface stops above the physical bottom
 * and a black strip shows under the tab bar / viewer bar.
 *
 * We measure the gap (full screen height minus window.innerHeight) and expose
 * it as `--standalone-gap`; the full-screen surfaces extend their bottom edge
 * by that amount. It is 0 in a browser tab, on desktop, and on any iOS
 * version that does not have the bug, so it corrects itself.
 */

/** Anything larger than this is not the status-bar bug (e.g. a keyboard). */
const MAX_GAP_PX = 80;

export interface GapWindow {
  innerHeight: number;
  innerWidth: number;
  screen: { width: number; height: number };
  matchMedia?: (query: string) => { matches: boolean };
  navigator: { standalone?: boolean };
}

export function isStandalone(win: GapWindow): boolean {
  if (win.navigator.standalone === true) return true;
  return typeof win.matchMedia === "function" && win.matchMedia("(display-mode: standalone)").matches;
}

export function measureStandaloneGap(win: GapWindow): number {
  if (!isStandalone(win)) return 0;
  const { width, height } = win.screen;
  const portrait = win.innerHeight >= win.innerWidth;
  const screenHeight = portrait ? Math.max(width, height) : Math.min(width, height);
  const gap = Math.round(screenHeight - win.innerHeight);
  return gap > 0 && gap <= MAX_GAP_PX ? gap : 0;
}

export function installStandaloneGap(): void {
  const win = window as unknown as GapWindow;
  const apply = () => {
    document.documentElement.style.setProperty("--standalone-gap", `${measureStandaloneGap(win)}px`);
  };
  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
}
