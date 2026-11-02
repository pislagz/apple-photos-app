import { useCallback, useEffect, useRef, useState } from "react";
import { type AssetListItem, getAssets } from "../../api";

export interface UseLibraryAssetsResult {
  items: AssetListItem[];
  loading: boolean;
  done: boolean;
  loadMore: () => void;
}

// Pages through `/api/libraries/{id}/assets` (never `/hidden`, so a hidden
// asset -- P1.13 -- can never reach any Library view). `loadMore` is a
// no-op while a page is in flight or after the last page, so the grid's
// scroll-near-bottom trigger can call it freely.
export function useLibraryAssets(libraryId: number): UseLibraryAssetsResult {
  const [items, setItems] = useState<AssetListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchPage = useCallback((libId: number, cursor: string | null, replace: boolean) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    getAssets(libId, cursor)
      .then((response) => {
        if (requestIdRef.current !== requestId) return;
        setItems((previous) => (replace ? response.items : [...previous, ...response.items]));
        cursorRef.current = response.next_cursor;
        setDone(!response.next_cursor);
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setDone(true);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  }, []);

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

  return { items, loading, done, loadMore };
}
