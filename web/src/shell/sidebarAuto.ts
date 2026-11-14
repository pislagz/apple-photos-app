// #368: like Mac Photos, a narrow window hides the sidebar by itself and the
// toggle (button and shortcut) stays off until the window is wide again. The
// user's own open/closed choice is kept apart so it comes back untouched.
export const SIDEBAR_AUTO_HIDE_WIDTH = 980;

export function isNarrow(width: number): boolean {
  return width < SIDEBAR_AUTO_HIDE_WIDTH;
}

export function effectiveSidebarCollapsed(userCollapsed: boolean, narrow: boolean): boolean {
  return narrow || userCollapsed;
}

// #392: narrow windows keep the toggle enabled. It opens the sidebar as an
// overlay (no grid reflow) instead of pushing the content aside.
export function sidebarOpen(userCollapsed: boolean, narrow: boolean, overlayOpen: boolean): boolean {
  return narrow ? overlayOpen : !userCollapsed;
}

// Cmd/Ctrl+Option+S is Photos' own "Show/Hide Sidebar". On a Mac, Option
// changes event.key ("ß"), so the physical key (event.code) decides.
export function isSidebarShortcut(event: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  if (!(event.metaKey || event.ctrlKey) || !event.altKey) return false;
  return event.code ? event.code === "KeyS" : event.key.toLowerCase() === "s";
}
