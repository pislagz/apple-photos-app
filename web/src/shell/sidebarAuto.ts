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

// The toggle flips only the user's choice, and does nothing while narrow.
export function toggleUserCollapsed(userCollapsed: boolean, narrow: boolean): boolean {
  return narrow ? userCollapsed : !userCollapsed;
}

// Cmd/Ctrl+Option+S is Photos' own "Show/Hide Sidebar"; plain Ctrl/Cmd+\ too.
export function isSidebarShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return (event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === "s";
}
