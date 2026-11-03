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

// Days zoom (design-refs/ios17-library-days.png): one full-width hero photo
// per day with its date overlaid, like iOS 17 -- not a header row, so there
// is no separate date label doubling the one drawn on the photo. Sized so
// its height is always exactly `2 * cellSize` -- no dynamic
// (ResizeObserver-based) measurement needed from the virtualizer.
export interface FeatureRow {
  type: "feature";
  key: string;
  label: string;
  items: AssetListItem[];
}

export type LibraryRow = HeaderRow | GridRow | FeatureRow;

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
    if (view === "days") {
      const [hero, ...rest] = group.items;
      rows.push({ type: "feature", key: `f-${group.key}`, label: group.label, items: [hero] });
      rows.push(...gridRows(rest, columns, group.label, `g-${group.key}`));
      continue;
    }
    rows.push({ type: "header", key: `h-${group.key}`, label: group.label });
    rows.push(...gridRows(group.items, columns, group.label, `g-${group.key}`));
  }
  return rows;
}
