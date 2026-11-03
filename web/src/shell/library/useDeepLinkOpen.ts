import { useEffect, useRef } from "react";
import type { AssetListItem } from "../../api";

// P1.17 "Copy Link": opens the Viewer on an asset id handed down from a
// pasted `/library/{id}/photo/{assetId}` URL (route.ts), once it shows up
// in this grid's own loaded pages. Pages incrementally via `loadMore` --
// the same catch-up pattern the arrow-key handler uses for a target past
// what's loaded -- rather than forcing a full fetch of a multi-terabyte
// library to find one asset. Never found (hidden, or not in this grid) is
// a silent no-op, consistent with the asset routes' 404-without-a-reason.
export function useDeepLinkOpen(
  assetId: string | undefined,
  items: AssetListItem[],
  loading: boolean,
  done: boolean,
  loadMore: () => void,
  openAtIndex: (index: number) => void,
  onConsumed?: () => void,
) {
  const wantedRef = useRef(assetId ?? null);

  useEffect(() => {
    const wanted = wantedRef.current;
    if (!wanted) return;
    const index = items.findIndex((item) => item.id === wanted);
    if (index !== -1) {
      openAtIndex(index);
      wantedRef.current = null;
      onConsumed?.();
    } else if (!loading) {
      if (!done) loadMore();
      else {
        wantedRef.current = null;
        onConsumed?.();
      }
    }
  }, [items, loading, done, loadMore, openAtIndex, onConsumed]);
}
