// Gap between desktop grid cells, in px. Applied inline as the CSS `gap` and
// used in the size math below, so layout and virtualizer heights can't drift.
// The smallest zoom uses a 1 px hairline (see `gapForEdge`).
export const GRID_GAP = 2;

// Desktop zoom (#207): the slider picks a target tile edge, not a column
// count, so the tile size does not jump while the window is resized.
export const ZOOM_EDGES = [72, 104, 150, 210, 300] as const;
export const DEFAULT_ZOOM_INDEX = 2;
// Width assumed before the grid is measured (tests, first paint).
export const UNMEASURED_WIDTH = 1000;
// The "grid" thumb is 300 px on its long side: it serves tiles up to a 150 px
// edge, and anything sharper than 300 device pixels needs "grid2x".
const GRID_THUMB_PX = 300;
const GRID_THUMB_MAX_EDGE = 150;

export function gapForEdge(edge: number): number {
  return edge <= ZOOM_EDGES[0] ? 1 : GRID_GAP;
}

export function columnsForEdge(containerWidth: number, edge: number, gap: number = gapForEdge(edge)): number {
  const width = containerWidth > 0 ? containerWidth : UNMEASURED_WIDTH;
  return Math.max(1, Math.floor((width + gap) / (edge + gap)));
}

export function thumbSizeFor(edge: number, devicePixelRatio: number = 1): "grid" | "grid2x" {
  return edge <= GRID_THUMB_MAX_EDGE && edge * Math.max(1, devicePixelRatio) <= GRID_THUMB_PX ? "grid" : "grid2x";
}

// Column widths whose edges sit on whole device pixels and which, with the
// gaps, add up to exactly `containerWidth`: the right edge is flush, with
// the leftover pixels spread across columns instead of left as a strip.
export function columnWidths(
  containerWidth: number,
  columns: number,
  gap: number = GRID_GAP,
  devicePixelRatio: number = 1,
): number[] {
  if (containerWidth <= 0 || columns <= 0) return [];
  const dpr = Math.max(1, devicePixelRatio);
  const pitch = (containerWidth + gap) / columns;
  const snap = (value: number) => Math.round(value * dpr) / dpr;
  const widths: number[] = [];
  for (let i = 0; i < columns; i++) {
    const left = snap(i * pitch);
    const right = i === columns - 1 ? containerWidth + gap : snap((i + 1) * pitch);
    widths.push(right - left - gap);
  }
  return widths;
}

// Tile height: the narrowest column, so tiles are square to the device pixel
// (a column may be one device pixel wider; `object-fit: cover` absorbs it).
export function squareEdge(containerWidth: number, columns: number, gap: number = GRID_GAP, devicePixelRatio = 1): number {
  const widths = columnWidths(containerWidth, columns, gap, devicePixelRatio);
  return widths.length ? Math.min(...widths) : 0;
}

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
