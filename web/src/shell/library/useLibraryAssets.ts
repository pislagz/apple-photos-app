import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AssetFilter, type AssetHide, type AssetListItem, getAssets } from "../../api";

export interface UseLibraryAssetsResult {
  items: AssetListItem[];
  loading: boolean;
  done: boolean;
  // True when the latest page request failed; `retry` re-requests that page.
  error: boolean;
  retry: () => void;
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
const NO_HIDE: readonly AssetHide[] = [];

// #224: the server pages newest first and so does this hook (`raw`, index 0 =
// newest, a stable origin that older pages never move). With `oldestFirst`
// (the Library, like Apple Photos) `items` is that list reversed: oldest on
// top, newest last, and `loadMore` adds the next OLDER page at the front.
export function useLibraryAssets(
  libraryId: number,
  anchorTo: string | null = null,
  filter: AssetFilter = "all",
  album: string | null = null,
  hide: readonly AssetHide[] = NO_HIDE,
  oldestFirst = false,
): UseLibraryAssetsResult {
  const [raw, setItems] = useState<AssetListItem[]>([]);
  const items = useMemo(() => (oldestFirst ? [...raw].reverse() : raw), [raw, oldestFirst]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchPage = useCallback((libId: number, cursor: string | null, replace: boolean) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(false);
    return getAssets(libId, cursor, 200, replace ? anchorTo : null, filter, album, hide)
      .then((response) => {
        if (requestIdRef.current !== requestId) return null;
        setItems((previous) => (replace ? response.items : [...previous, ...response.items]));
        cursorRef.current = response.next_cursor;
        setDone(!response.next_cursor);
        return response;
      })
      .catch(() => {
        // `done` stays true so the scroll trigger doesn't hammer a failing
        // endpoint; `error` lets the view say so instead of looking empty.
        if (requestIdRef.current === requestId) {
          setDone(true);
          setError(true);
        }
        return null;
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  }, [anchorTo, filter, album, hide]);

  useEffect(() => {
    cursorRef.current = null;
    setDone(false);
    setError(false);
    setItems([]);
    fetchPage(libraryId, null, true);
  }, [libraryId, fetchPage]);

  const loadMore = useCallback(() => {
    if (loading || done) return;
    fetchPage(libraryId, cursorRef.current, false);
  }, [libraryId, loading, done, fetchPage]);

  const retry = useCallback(() => {
    setDone(false);
    fetchPage(libraryId, cursorRef.current, cursorRef.current === null);
  }, [libraryId, fetchPage]);

  // ⌘A (desktop Library) has to select the whole non-hidden library, not
  // just the pages scrolled into view so far: page through `/assets`
  // sequentially -- bypassing the scroll-triggered `loadMore` entirely --
  // until the server reports no further cursor.
  const loadAll = useCallback(async (): Promise<AssetListItem[]> => {
    let all = raw;
    let cursor = cursorRef.current;
    let finished = done;
    while (!finished) {
      const response = await fetchPage(libraryId, cursor, false);
      if (!response) break;
      all = [...all, ...response.items];
      cursor = response.next_cursor;
      finished = !cursor;
    }
    return oldestFirst ? [...all].reverse() : all;
  }, [libraryId, raw, oldestFirst, done, fetchPage]);

  return { items, loading, done, error, retry, loadMore, loadAll };
}
