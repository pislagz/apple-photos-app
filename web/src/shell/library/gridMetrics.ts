// Gap between desktop grid cells, in px. Applied inline as the CSS `gap` and
// used in the size math below, so layout and virtualizer heights can't drift.
export const GRID_GAP = 2;

// Real column width once the (columns - 1) gaps are taken out of the container.
export function computeCellSize(containerWidth: number, columns: number, gap: number = GRID_GAP): number {
  if (containerWidth <= 0 || columns <= 0) return 0;
  return Math.max(0, (containerWidth - (columns - 1) * gap) / columns);
}

// Days lead photo (#153). Its size used to follow the thumbnail columns (full
// width, two rows tall), so a wide window made it ~3:1 and huge, cropping the
// photo to a strip. It is now capped in width and has a fixed 2:1 aspect,
// independent of the zoom level, so it stays moderate at any window size.
export const FEATURE_MAX_WIDTH = 960;
export const FEATURE_ASPECT = 2;

export function featureWidth(containerWidth: number): number {
  return Math.max(0, Math.min(containerWidth, FEATURE_MAX_WIDTH));
}

export function featureHeight(containerWidth: number): number {
  return Math.round(featureWidth(containerWidth) / FEATURE_ASPECT);
}

// Virtualized row height: the cell plus a trailing gap, giving the same
// vertical spacing as the horizontal gap between cells.
export function gridRowHeight(cellSize: number, gap: number = GRID_GAP): number {
  return cellSize + gap;
}

export function featureRowHeight(containerWidth: number, gap: number = GRID_GAP): number {
  return featureHeight(containerWidth) + gap;
}
