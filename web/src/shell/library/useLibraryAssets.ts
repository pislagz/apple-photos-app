import { useCallback, useEffect, useRef, useState } from "react";
import { type AssetFilter, type AssetListItem, getAssets } from "../../api";

export interface UseLibraryAssetsResult {
  items: AssetListItem[];
  loading: boolean;
  done: boolean;
  loadMore: () => void;
  loadAll: () => Promise<AssetListItem[]>;
}

// Pages through `/api/libraries/{id}/assets` (never `/hidden`, so a hidden
// asset -- P1.13 -- can never reach any Library view). `loadMore` is a
// no-op while a page is in flight or after the last page, so the grid's
// scroll-near-bottom trigger can call it freely. `anchorTo` (#91's Month ->
// Days drill-down) starts the first page at that local day instead of the
// top of the library, so landing on a month deep in the library's history
// doesn't page through everything newer first.
export function useLibraryAssets(libraryId: number, anchorTo: string | null = null, filter: AssetFilter = "all"): UseLibraryAssetsResult {
  const [items, setItems] = useState<AssetListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchPage = useCallback((libId: number, cursor: string | null, replace: boolean) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    return getAssets(libId, cursor, 200, replace ? anchorTo : null, filter)
      .then((response) => {
        if (requestIdRef.current !== requestId) return null;
        setItems((previous) => (replace ? response.items : [...previous, ...response.items]));
        cursorRef.current = response.next_cursor;
        setDone(!response.next_cursor);
        return response;
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setDone(true);
        return null;
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  }, [anchorTo, filter]);

  useEffect(() => {
    cursorRef.current = null;
    setDone(false);
    setItems([]);
    fetchPage(libraryId, null, true);
  }, [libraryId, fetchPage]);

  const loadMore = useCallback(() => {
    if (loading || done) return;
    fetchPage(libraryId, cursorRef.current, false);
  }, [libraryId, loading, done, fetchPage]);

  // ⌘A (desktop Library) has to select the whole non-hidden library, not
  // just the pages scrolled into view so far: page through `/assets`
  // sequentially -- bypassing the scroll-triggered `loadMore` entirely --
  // until the server reports no further cursor.
  const loadAll = useCallback(async (): Promise<AssetListItem[]> => {
    let all = items;
    let cursor = cursorRef.current;
    let finished = done;
    while (!finished) {
      const response = await fetchPage(libraryId, cursor, false);
      if (!response) break;
      all = [...all, ...response.items];
      cursor = response.next_cursor;
      finished = !cursor;
    }
    return all;
  }, [libraryId, items, done, fetchPage]);

  return { items, loading, done, loadMore, loadAll };
}
