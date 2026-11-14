// Pure logic for iPhone swipe-select (#222).

// The first tile touched decides the mode: unselected -> the drag selects,
// selected -> the drag deselects.
export type SwipeMode = "select" | "deselect";

// The ids between the start and current tile (inclusive, reading order) are
// forced to `mode`; everything else keeps its state from the gesture start,
// so pulling the finger back shrinks the run live.
export function rangeSelection(
  order: readonly string[],
  startIndex: number,
  currentIndex: number,
  base: ReadonlySet<string>,
  mode: SwipeMode,
): Set<string> {
  const next = new Set(base);
  const from = Math.max(0, Math.min(startIndex, currentIndex));
  const to = Math.min(order.length - 1, Math.max(startIndex, currentIndex));
  for (let i = from; i <= to; i += 1) {
    if (mode === "select") next.add(order[i]);
    else next.delete(order[i]);
  }
  return next;
}

export const EDGE_ZONE = 90;
export const MAX_SCROLL_STEP = 14;

// Pixels to scroll this frame: 0 away from the edges, growing with depth into
// the 90 px zone at the top (negative) or bottom (positive) of the list.
export function autoScrollStep(y: number, top: number, bottom: number): number {
  if (y < top + EDGE_ZONE) return -Math.round((Math.min(EDGE_ZONE, top + EDGE_ZONE - y) / EDGE_ZONE) * MAX_SCROLL_STEP);
  if (y > bottom - EDGE_ZONE) return Math.round((Math.min(EDGE_ZONE, y - (bottom - EDGE_ZONE)) / EDGE_ZONE) * MAX_SCROLL_STEP);
  return 0;
}

// Horizontal start: |dx| >= 1.2 |dy| on the first real movement.
export function isHorizontalStart(dx: number, dy: number): boolean {
  return Math.abs(dx) >= 1.2 * Math.abs(dy);
}
