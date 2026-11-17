import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AssetFilter, type AssetHide, type AssetListItem, getAssets } from "../../api";

export interface UseLibraryAssetsResult {
  items: AssetListItem[];
  // Photos matching the request, known after the first page (#365); else null.
  total: number | null;
  loading: boolean;
  done: boolean;
  // True when the latest page request failed; `retry` re-requests that page.
  error: boolean;
  retry: () => void;
  loadMore: () => void;
  // After an anchored first page (`anchorTo`): photos newer than the loaded
  // window are still on the server. `newerLeft` counts them.
  hasNewer: boolean;
  newerLeft: number;
  loadNewer: () => void;
  // The `anchorTo` the loaded items were fetched with (undefined until the
  // first page of the current request arrives).
  loadedAnchor: string | null | undefined;
}

// Pages through `/api/libraries/{id}/assets` (never `/hidden`, so a hidden
// asset -- P1.13 -- can never reach any Library view). `loadMore` is a
// no-op while a page is in flight or after the last page, so the grid's
// scroll-near-bottom trigger can call it freely. `anchorTo` (#91's Month ->
// Days drill-down) starts the first page at that local day instead of the
// top of the library, so landing on a month deep in the library's history
// doesn't page through everything newer first.
// Result of a page fetch that a newer request invalidated; not a failure.
const SUPERSEDED = Symbol("superseded");
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
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const cursorRef = useRef<string | null>(null);
  // Mirrors `raw` in step with `cursorRef`, so a page appended while the
  // state lags a render behind is never dropped (#465).
  const rawRef = useRef<AssetListItem[]>([]);
  const requestIdRef = useRef(0);
  const newerCursorRef = useRef<string | null>(null);
  const newerBusyRef = useRef(false);
  const epochRef = useRef(0);
  const [newerLeft, setNewerLeft] = useState(0);
  const [hasNewer, setHasNewer] = useState(false);
  const [loadedAnchor, setLoadedAnchor] = useState<string | null | undefined>(undefined);

  const fetchPage = useCallback((libId: number, cursor: string | null, replace: boolean) => {
    const requestId = ++requestIdRef.current;
    if (replace) epochRef.current++;
    setLoading(true);
    setError(false);
    return getAssets(libId, cursor, 200, replace ? anchorTo : null, filter, album, hide)
      .then(async (response) => {
        if (requestIdRef.current !== requestId) return SUPERSEDED;
        let items = response.items;
        let prevCursor = response.prev_cursor ?? null;
        let newer = response.newer_total ?? 0;
        if (replace && anchorTo && prevCursor) {
          // Around the date: a page of newer photos too, so the date is not
          // at the very end of the list when the grid scrolls to it.
          const above = await getAssets(libId, prevCursor, 200, null, filter, album, hide, "newer").catch(() => null);
          if (requestIdRef.current !== requestId) return SUPERSEDED;
          if (above) {
            items = [...above.items, ...items];
            prevCursor = above.prev_cursor ?? null;
            newer = Math.max(0, newer - above.items.length);
          }
        }
        if (replace) {
          const total = response.total == null ? null : response.total + (response.newer_total ?? 0);
          setTotal(total);
          newerCursorRef.current = prevCursor;
          setNewerLeft(newer);
          setHasNewer(newer > 0 && !!prevCursor);
          setLoadedAnchor(anchorTo);
        }
        rawRef.current = replace ? items : [...rawRef.current, ...items];
        setItems(rawRef.current);
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
    rawRef.current = [];
    setDone(false);
    setError(false);
    setItems([]);
    setTotal(null);
    setHasNewer(false);
    setNewerLeft(0);
    newerCursorRef.current = null;
    newerBusyRef.current = false;
    setLoadedAnchor(undefined);
    fetchPage(libraryId, null, true);
  }, [libraryId, fetchPage]);

  const loadMore = useCallback(() => {
    if (loading || done) return;
    fetchPage(libraryId, cursorRef.current, false);
  }, [libraryId, loading, done, fetchPage]);

  // Newer photos arrive at the front of `raw` (newest first); in the
  // oldest-first grid that is the bottom, so nothing already on screen moves.
  const loadNewer = useCallback(() => {
    const cursor = newerCursorRef.current;
    if (!cursor || newerBusyRef.current) return;
    newerBusyRef.current = true;
    const epoch = epochRef.current;
    getAssets(libraryId, cursor, 200, null, filter, album, hide, "newer")
      .then((response) => {
        if (epochRef.current !== epoch) return;
        rawRef.current = [...response.items, ...rawRef.current];
        setItems(rawRef.current);
        newerCursorRef.current = response.prev_cursor ?? null;
        setHasNewer(!!response.prev_cursor);
        setNewerLeft((left) => Math.max(0, left - response.items.length));
      })
      .catch(() => {
        if (epochRef.current === epoch) setHasNewer(false);
      })
      .finally(() => {
        if (epochRef.current === epoch) newerBusyRef.current = false;
      });
  }, [libraryId, filter, album, hide]);

  const retry = useCallback(() => {
    setDone(false);
    fetchPage(libraryId, cursorRef.current, cursorRef.current === null);
  }, [libraryId, fetchPage]);

  return { items, total, loading, done, error, retry, loadMore, hasNewer, newerLeft, loadNewer, loadedAnchor };
}
