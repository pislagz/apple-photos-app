import type { ViewKey } from "./grouping";

// iPhone zoom ladder (#213), coarsest first. The Years/Months/All Photos tabs
// and the pinch are the same state: a pinch just moves along this list.
export type GridColumns = 1 | 3 | 5;
export interface ZoomLevel {
  view: "years" | "months" | "all";
  columns: GridColumns;
}

export const DEFAULT_COLUMNS: GridColumns = 3;
export const ZOOM_LEVELS: readonly ZoomLevel[] = [
  { view: "years", columns: 5 },
  { view: "months", columns: 5 },
  { view: "all", columns: 5 },
  { view: "all", columns: 3 },
  { view: "all", columns: 1 },
];

export const MIN_PINCH_SCALE = 0.25;
export const MAX_PINCH_SCALE = 4;

export function clampScale(scale: number): number {
  return Math.min(MAX_PINCH_SCALE, Math.max(MIN_PINCH_SCALE, scale));
}

// Levels to move on release: positive zooms in (fewer, bigger photos).
export function stepsForScale(scale: number): number {
  if (scale > 2.2) return 2;
  if (scale > 1.12) return 1;
  if (scale < 0.45) return -2;
  if (scale < 0.88) return -1;
  return 0;
}

// Days has no level of its own: it sits with the 5-column grid, so a pinch
// out reaches Months and a pinch in reaches 3 columns.
export function levelIndex(view: ViewKey, columns: number): number {
  if (view === "years") return 0;
  if (view === "months") return 1;
  if (view === "days") return 2;
  return columns <= 1 ? 4 : columns <= 3 ? 3 : 2;
}

export function levelAfter(view: ViewKey, columns: number, steps: number): ZoomLevel {
  const index = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, levelIndex(view, columns) + steps));
  const level = ZOOM_LEVELS[index];
  // Years and Months keep the grid's own column count for when you come back.
  return level.view === "all" ? level : { view: level.view, columns: columns as GridColumns };
}
