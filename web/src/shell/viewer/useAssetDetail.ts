import { useEffect, useState } from "react";
import { type AssetDetailResponse, type SelectionSummary, getAssetDetail, getSelectionSummary } from "../../api";

export interface AssetDetailState {
  detail: AssetDetailResponse | null;
  // True when the last fetch for the current asset failed, so a panel can
  // say so instead of showing "Loading…" forever.
  failed: boolean;
}

// Fetches the info-panel/sheet fields for whichever asset is current in the
// Viewer or the Library inspector. This is the JSON detail route, not
// `/original` -- it never affects the "preview thumb first" rule the media
// itself follows.
export function useAssetDetailState(libraryId: number, assetId: string | null): AssetDetailState {
  const [state, setState] = useState<AssetDetailState>({ detail: null, failed: false });

  useEffect(() => {
    setState({ detail: null, failed: false });
    if (!assetId) return;
    let cancelled = false;
    getAssetDetail(libraryId, assetId).then(
      (response) => {
        if (!cancelled) setState({ detail: response, failed: false });
      },
      () => {
        if (!cancelled) setState({ detail: null, failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [libraryId, assetId]);

  return state;
}

export function useAssetDetail(libraryId: number, assetId: string | null): AssetDetailResponse | null {
  return useAssetDetailState(libraryId, assetId).detail;
}

const SUMMARY_DEBOUNCE_MS = 150;

// D21: summary of a multi-selection for the desktop Info panel. Pass `null`
// ids to stay idle. Debounced so a drag-select or Shift+arrows does not post
// one request per change.
export function useSelectionSummary(
  libraryId: number,
  assetIds: string[] | null,
): { summary: SelectionSummary | null; failed: boolean } {
  const [state, setState] = useState<{ summary: SelectionSummary | null; failed: boolean }>({ summary: null, failed: false });
  const key = assetIds ? assetIds.join(",") : null;

  useEffect(() => {
    setState({ summary: null, failed: false });
    if (key === null) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getSelectionSummary(libraryId, key.split(",")).then(
        (summary) => {
          if (!cancelled) setState({ summary, failed: false });
        },
        () => {
          if (!cancelled) setState({ summary: null, failed: true });
        },
      );
    }, SUMMARY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [libraryId, key]);

  return state;
}
