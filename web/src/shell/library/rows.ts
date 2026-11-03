import type { AssetListItem } from "../../api";
import { type ViewKey, formatGroupLabel, groupAssets } from "./grouping";

export interface HeaderRow {
  type: "header";
  key: string;
  label: string;
}

export interface GridRow {
  type: "grid";
  key: string;
  label: string;
  items: AssetListItem[];
}

// Days zoom (design-refs/ios17-library-days.png): a large leading cell plus
// a row of squares beside it, both inside the same two-cell-tall band. Sized
// so its height is always exactly `2 * cellSize` -- no dynamic
// (ResizeObserver-based) measurement needed from the virtualizer.
export interface FeatureRow {
  type: "feature";
  key: string;
  label: string;
  items: AssetListItem[];
}

export type LibraryRow = HeaderRow | GridRow | FeatureRow;

// How many items fit in a Days feature band for a given column count: one
// 2x2 leading cell, plus the remaining (columns - 2) columns across both of
// its rows. At columns <= 2 the leading cell alone fills the band.
export function featureCapacity(columns: number): number {
  return columns <= 2 ? 1 : 1 + 2 * (columns - 2);
}

function gridRows(items: AssetListItem[], columns: number, label: string, keyPrefix: string): GridRow[] {
  const rows: GridRow[] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push({ type: "grid", key: `${keyPrefix}-${i}`, label, items: items.slice(i, i + columns) });
  }
  return rows;
}

export function buildRows(items: AssetListItem[], view: ViewKey, columns: number): LibraryRow[] {
  if (view === "all") {
    // Uniform square grid, no inline headers -- the pinned header still
    // tracks a day-level label per row for the topmost-visible lookup.
    const rows: GridRow[] = [];
    for (let i = 0; i < items.length; i += columns) {
      const slice = items.slice(i, i + columns);
      const label = formatGroupLabel(slice[0]?.date ? slice[0].date.slice(0, 10) : "", "days");
      rows.push({ type: "grid", key: `all-${i}`, label, items: slice });
    }
    return rows;
  }

  const rows: LibraryRow[] = [];
  for (const group of groupAssets(items, view)) {
    rows.push({ type: "header", key: `h-${group.key}`, label: group.label });
    if (view === "days") {
      const capacity = featureCapacity(columns);
      const feature = group.items.slice(0, capacity);
      rows.push({ type: "feature", key: `f-${group.key}`, label: group.label, items: feature });
      rows.push(...gridRows(group.items.slice(capacity), columns, group.label, `g-${group.key}`));
    } else {
      rows.push(...gridRows(group.items, columns, group.label, `g-${group.key}`));
    }
  }
  return rows;
}
