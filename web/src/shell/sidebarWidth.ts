export const SIDEBAR_MIN = 190;
export const SIDEBAR_DEFAULT = 220;
export const SIDEBAR_MAX = 300;
export const SIDEBAR_WIDTH_KEY = "photos-viewer.sidebar-width";

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value)));
}

export function readSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return raw === null ? SIDEBAR_DEFAULT : clampSidebarWidth(Number(raw));
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

export function writeSidebarWidth(width: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    /* storage unavailable: the width just doesn't persist */
  }
}
