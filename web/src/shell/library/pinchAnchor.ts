import type { LibraryRow } from "./rows";

// What stays put under the fingers while a pinch changes the column count:
// the asset under the pinch midpoint, where in its row the midpoint was
// (0..1), and where that point sat in the viewport.
export interface PinchAnchor {
  assetId: string;
  rowFraction: number;
  viewportY: number;
}

export function assetIdAtPoint(row: LibraryRow | undefined, x: number, cellSize: number): string | null {
  if (!row || (row.type !== "grid" && row.type !== "feature")) return null;
  if (row.type === "feature" || cellSize <= 0) return row.items[0]?.id ?? null;
  const column = Math.min(row.items.length - 1, Math.max(0, Math.floor(x / cellSize)));
  return row.items[column]?.id ?? null;
}

export function findRowIndexByAsset(rows: LibraryRow[], assetId: string): number {
  return rows.findIndex((row) => (row.type === "grid" || row.type === "feature") && row.items.some((i) => i.id === assetId));
}

// scrollTop that puts the anchored point of the asset's new row back at the
// same viewport offset, clamped to the scrollable range.
export function anchoredScrollTop(
  anchor: Pick<PinchAnchor, "rowFraction" | "viewportY">,
  newRowStart: number,
  newRowSize: number,
  totalSize: number,
  viewportHeight: number,
): number {
  const target = newRowStart + anchor.rowFraction * newRowSize - anchor.viewportY;
  return Math.min(Math.max(0, totalSize - viewportHeight), Math.max(0, target));
}
