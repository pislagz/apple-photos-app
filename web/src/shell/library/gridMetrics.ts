// Gap between desktop grid cells, in px. Applied inline as the CSS `gap` and
// used in the size math below, so layout and virtualizer heights can't drift.
export const GRID_GAP = 2;

// Real column width once the (columns - 1) gaps are taken out of the container.
export function computeCellSize(containerWidth: number, columns: number, gap: number = GRID_GAP): number {
  if (containerWidth <= 0 || columns <= 0) return 0;
  return Math.max(0, (containerWidth - (columns - 1) * gap) / columns);
}

// Feature (Days hero) cells span the full width and two rows plus the gap between.
export function cellHeight(cellSize: number, isFeature: boolean, gap: number = GRID_GAP): number {
  return isFeature ? cellSize * 2 + gap : cellSize;
}

// Virtualized row height: the cell plus a trailing gap, giving the same
// vertical spacing as the horizontal gap between cells.
export function gridRowHeight(cellSize: number, isFeature: boolean, gap: number = GRID_GAP): number {
  return cellHeight(cellSize, isFeature, gap) + gap;
}
