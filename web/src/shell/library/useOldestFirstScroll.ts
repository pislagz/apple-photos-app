import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AssetListItem } from "../../api";
import type { LibraryRow } from "./rows";

// #224: the Library lists oldest first and opens at the newest photos, at the
// bottom. Older pages are added above, so this hook keeps what the user is
// looking at where it is.

function lastItemId(row: LibraryRow | undefined): string | undefined {
  return row && row.type !== "header" ? row.items[row.items.length - 1]?.id : undefined;
}

function firstItemId(row: LibraryRow | undefined): string | undefined {
  return row && row.type !== "header" ? row.items[0]?.id : undefined;
}

// Scroll position that keeps the row at `scrollTop` of `before` in place once
// `after` (the same rows plus older ones on top) is laid out. Row heights come
// from `rowSize`, the same numbers the virtualiser estimates with.
export function compensatedScrollTop(
  scrollTop: number,
  before: LibraryRow[],
  after: LibraryRow[],
  rowSize: (row: LibraryRow) => number,
): number {
  let start = 0;
  let anchorId: string | undefined;
  let offset = 0;
  for (const row of before) {
    const height = rowSize(row);
    if (start + height > scrollTop && row.type !== "header") {
      anchorId = row.items[row.items.length - 1]?.id;
      offset = scrollTop - start;
      break;
    }
    start += height;
  }
  if (!anchorId) return scrollTop;
  let newStart = 0;
  for (const row of after) {
    if (row.type !== "header" && row.items.some((item) => item.id === anchorId)) return newStart + offset;
    newStart += rowSize(row);
  }
  return scrollTop;
}

export interface OldestFirstScroll {
  scrollToEnd: (smooth?: boolean) => void;
}

// `rows` run oldest to newest. `ready` is false while the grid has no width or
// shows period cards instead of photos: the next time it is true the list is
// scrolled to its end. After that, rows added on top shift the content down;
// the scroll offset moves by the same amount so nothing jumps.
export function useOldestFirstScroll({
  scrollRef,
  rows,
  rowSize,
  ready,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  rows: LibraryRow[];
  rowSize: (row: LibraryRow) => number;
  ready: boolean;
}): OldestFirstScroll {
  const previousRows = useRef<LibraryRow[]>([]);
  const needsEnd = useRef(true);
  const rowSizeRef = useRef(rowSize);
  rowSizeRef.current = rowSize;

  useLayoutEffect(() => {
    const previous = previousRows.current;
    previousRows.current = rows;
    const element = scrollRef.current;
    if (!ready || !element || rows.length === 0) {
      needsEnd.current = true;
      return;
    }
    if (needsEnd.current) {
      needsEnd.current = false;
      element.scrollTop = element.scrollHeight;
      return;
    }
    if (previous.length === 0) return;
    // Older rows were added on top: the newest row is unchanged, the oldest is not.
    if (lastItemId(previous[previous.length - 1]) !== lastItemId(rows[rows.length - 1]) || firstItemId(previous[0]) === firstItemId(rows[0])) return;
    const next = compensatedScrollTop(element.scrollTop, previous, rows, rowSizeRef.current);
    if (next !== element.scrollTop) element.scrollTop = next;
  }, [scrollRef, rows, ready]);

  const scrollToEnd = useCallback(
    (smooth = false) => {
      const element = scrollRef.current;
      if (!element) return;
      const reduce = smooth && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (smooth && !reduce && element.scrollTo) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
      else element.scrollTop = element.scrollHeight;
    },
    [scrollRef],
  );

  return useMemo(() => ({ scrollToEnd }), [scrollToEnd]);
}

// The Viewer's position by asset id, so older pages added on top (which shift
// every index) cannot move it to another photo.
export function useViewerIndex(items: AssetListItem[]): [number | null, (index: number | null) => void] {
  const [id, setId] = useState<string | null>(null);
  const index = useMemo(() => {
    if (id === null) return null;
    const found = items.findIndex((item) => item.id === id);
    return found === -1 ? null : found;
  }, [id, items]);
  const setIndex = useCallback((next: number | null) => setId(next === null ? null : (items[next]?.id ?? null)), [items]);
  return [index, setIndex];
}

// Landing on a day or month ("2022-05" / "2022-05-10") from a card: keep
// loading older pages until the list reaches back past that period (or ends),
// then scroll to the period's first photo. `scrollToRow` gets its row index.
export function useLandOnPeriod({
  key,
  active,
  items,
  rows,
  loading,
  done,
  loadMore,
  scrollToRow,
  onLanded,
}: {
  key: string | null;
  active: boolean;
  items: AssetListItem[];
  rows: LibraryRow[];
  loading: boolean;
  done: boolean;
  loadMore: () => void;
  scrollToRow: (rowIndex: number) => void;
  onLanded: () => void;
}) {
  useLayoutEffect(() => {
    if (!key || !active) return;
    const oldest = items[0]?.date;
    const reached = done || (oldest !== undefined && oldest !== null && oldest.slice(0, key.length) < key);
    if (!reached) {
      // Not before the first page: the hook is already fetching it.
      if (!loading && items.length > 0) loadMore();
      return;
    }
    const rowIndex = rows.findIndex((row) => row.type !== "header" && row.items.some((item) => (item.date ?? "").slice(0, key.length) >= key));
    if (rowIndex !== -1) scrollToRow(rowIndex);
    onLanded();
  }, [key, active, items, rows, loading, done, loadMore, scrollToRow, onLanded]);
}
