// #418: iOS 26 standalone (home-screen) PWAs can report the viewport about one
// status-bar height (~59px) too short on a cold start, so every vh/dvh/
// fill-available layout ends above the real bottom edge and a black strip
// shows under the tab bar. Rotating fixes it. CSS cannot recover the missing
// height, so we measure the screen in JS and publish it as `--app-height`.
// Approach follows rcarmo/piclaw docs/PWA.md. Only active on iOS standalone;
// Safari tabs, desktop and other platforms never get the variable.

export interface HeightInputs {
  standalone: boolean;
  innerHeight: number;
  clientHeight: number;
  /** `visualViewport.height`, or undefined where unsupported. */
  vvHeight?: number;
  screenWidth: number;
  screenHeight: number;
  portrait: boolean;
}

/** Largest shortfall we treat as the iOS bug rather than a real smaller area. */
const MAX_GAP = 100;
/** A visual viewport this much shorter than the layout viewport is the keyboard. */
const KEYBOARD_DELTA = 120;

/** Height to publish as `--app-height`, or null to leave CSS alone. */
export function computeAppHeight(i: HeightInputs): number | null {
  if (!i.standalone) return null;
  const layout = Math.max(i.innerHeight, i.clientHeight);
  const vv = i.vvHeight ?? layout;
  // On-screen keyboard: follow the visual viewport, never force full height.
  if (vv < layout - KEYBOARD_DELTA) return vv;
  // screen.* is orientation-dependent across iOS versions; pick by orientation.
  const full = i.portrait
    ? Math.max(i.screenWidth, i.screenHeight)
    : Math.min(i.screenWidth, i.screenHeight);
  const seen = Math.max(layout, vv);
  const gap = full - seen;
  return gap > 0 && gap <= MAX_GAP ? full : seen;
}

export function isIosStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return standalone && ios;
}

export function measureAppHeight(): number | null {
  return computeAppHeight({
    standalone: isIosStandalone(),
    innerHeight: window.innerHeight,
    clientHeight: document.documentElement.clientHeight,
    vvHeight: window.visualViewport?.height,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    portrait: window.matchMedia("(orientation: portrait)").matches,
  });
}

function apply(): void {
  const root = document.documentElement;
  const h = measureAppHeight();
  if (h === null) {
    root.style.removeProperty("--app-height");
    root.classList.remove("has-app-height");
  } else {
    root.style.setProperty("--app-height", `${Math.round(h)}px`);
    root.classList.add("has-app-height");
  }
}

export function installAppHeight(): void {
  if (!isIosStandalone()) return;
  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", () => {
    apply();
    setTimeout(apply, 300);
  });
  window.visualViewport?.addEventListener("resize", apply);
  window.addEventListener("pageshow", apply);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) apply();
  });
  // The cold-start value settles late; re-check a few times.
  for (const ms of [100, 500, 1500]) setTimeout(apply, ms);
}
