// Gap between desktop grid cells, in px. Applied inline as the CSS `gap` and
// used in the size math below, so layout and virtualizer heights can't drift.
export const GRID_GAP = 2;

// Real column width once the (columns - 1) gaps are taken out of the container.
export function computeCellSize(containerWidth: number, columns: number, gap: number = GRID_GAP): number {
  if (containerWidth <= 0 || columns <= 0) return 0;
  return Math.max(0, (containerWidth - (columns - 1) * gap) / columns);
}

// Days lead photo (#153, #170). Below FEATURE_NARROW_WIDTH it is full width
// and two thumbnail rows tall (the original rule, ~2.5:1 at the default zoom).
// From there up it is capped in width with a fixed 2:1 aspect, so a wide window
// does not crop the photo to a strip. The cap starts at FEATURE_MAX_WIDTH and,
// from FEATURE_SCALE_FROM, grows toward FEATURE_COLUMNS columns' worth of
// thumbnails so at 2560 with large thumbnails it does not look small next to
// the grid. It blends in linearly over FEATURE_SCALE_RAMP px instead of
// switching on at once: with a hard switch the photo jumped by ~100 px at
// exactly 1600 (#177). Never wider than the content.
export const FEATURE_NARROW_WIDTH = 960;
export const FEATURE_MAX_WIDTH = 960;
export const FEATURE_ASPECT = 2;
export const FEATURE_SCALE_FROM = 1600;
export const FEATURE_SCALE_RAMP = 800;
export const FEATURE_COLUMNS = 4;

export function featureWidth(containerWidth: number, cellSize: number = 0, gap: number = GRID_GAP): number {
  if (containerWidth < FEATURE_NARROW_WIDTH) return Math.max(0, containerWidth);
  const scaled = FEATURE_COLUMNS * cellSize + (FEATURE_COLUMNS - 1) * gap;
  const blend = Math.min(1, Math.max(0, (containerWidth - FEATURE_SCALE_FROM) / FEATURE_SCALE_RAMP));
  const cap = FEATURE_MAX_WIDTH + blend * Math.max(0, scaled - FEATURE_MAX_WIDTH);
  return Math.min(containerWidth, cap);
}

export function featureHeight(containerWidth: number, cellSize: number = 0, gap: number = GRID_GAP): number {
  if (containerWidth < FEATURE_NARROW_WIDTH) return Math.max(0, Math.round(cellSize * 2 + gap));
  return Math.round(featureWidth(containerWidth, cellSize, gap) / FEATURE_ASPECT);
}

// Virtualized row height: the cell plus a trailing gap, giving the same
// vertical spacing as the horizontal gap between cells.
export function gridRowHeight(cellSize: number, gap: number = GRID_GAP): number {
  return cellSize + gap;
}

export function featureRowHeight(containerWidth: number, cellSize: number = 0, gap: number = GRID_GAP): number {
  return featureHeight(containerWidth, cellSize, gap) + gap;
}
