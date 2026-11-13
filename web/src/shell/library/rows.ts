import type { AssetListItem, SummaryPeriodBucket } from "../../api";
import type { PeriodCardData } from "./PeriodCards";
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

// #307: Years and Months read `/summary`'s buckets directly. The server
// returns them oldest first (`ORDER BY key`) and that is the display order:
// oldest on top, the view opens scrolled down to the newest.
// "Jan 2007", the Apple Photos card label.
function formatShortMonth(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, 1)).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// "May 12" for the current year, "May 12, 2022" otherwise (Apple Photos).
function formatDayCardLabel(key: string, currentYear: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(year === currentYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

export function buildPeriodCards(
  buckets: SummaryPeriodBucket[],
  view: "years" | "months" | "days",
  currentYear = new Date().getFullYear(),
): PeriodCardData[] {
  return buckets.map((bucket) => ({
    key: bucket.key,
    label:
      view === "months"
        ? formatShortMonth(bucket.key)
        : view === "days"
          ? formatDayCardLabel(bucket.key, currentYear)
          : formatGroupLabel(bucket.key, view),
    count: bucket.count,
    keyAssetIds: bucket.key_asset_ids ?? [],
  }));
}

// Column of `id` within its grid row, or `null` for a full-width row (the Days
// lead photo) and for ids outside the row model.
export function columnOf(rows: LibraryRow[], id: string): number | null {
  for (const row of rows) {
    if (row.type !== "grid") continue;
    const column = row.items.findIndex((i) => i.id === id);
    if (column !== -1) return column;
  }
  return null;
}

// Id of the cell visually above (`-1`) / below (`1`) `fromId`, in `column`
// (clamped on a shorter row). `column` is the caller's remembered goal column
// (D12): a full-width row has no column of its own, and a short row clamps it,
// so without it the column is lost after the Days lead photo. Omitted, it is the
// column `fromId` sits in (0 on a full-width row). `null`: already at the top
// edge. `"end"`: at the bottom edge, where the caller decides whether to load
// more (#96). `"unknown"`: `fromId` is not in the row model (e.g. a header row), so the caller falls back to flat +-columns movement.
export function verticalTarget(
  rows: LibraryRow[],
  fromId: string,
  direction: 1 | -1,
  column?: number,
): string | null | "end" | "unknown" {
  const rowIndex = rows.findIndex((row) => row.type !== "header" && row.items.some((i) => i.id === fromId));
  if (rowIndex === -1) return "unknown";
  const row = rows[rowIndex];
  if (row.type === "header") return "unknown";
  const goal = column ?? (row.type === "feature" ? 0 : row.items.findIndex((i) => i.id === fromId));
  for (let i = rowIndex + direction; i >= 0 && i < rows.length; i += direction) {
    const next = rows[i];
    if (next.type === "header") continue;
    return next.items[Math.min(goal, next.items.length - 1)].id;
  }
  return direction === 1 ? "end" : null;
}
