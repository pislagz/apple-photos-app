import { useEffect, useState } from "react";
import { type AssetDetailResponse, getAssetDetail } from "../../api";

// Fetches the info-panel/sheet fields for whichever asset is current in the
// Viewer. This is the JSON detail route, not `/original` -- it never
// affects the "preview thumb first" rule the media itself follows.
export function useAssetDetail(libraryId: number, assetId: string | null): AssetDetailResponse | null {
  const [detail, setDetail] = useState<AssetDetailResponse | null>(null);

  useEffect(() => {
    setDetail(null);
    if (!assetId) return;
    let cancelled = false;
    getAssetDetail(libraryId, assetId).then(
      (response) => {
        if (!cancelled) setDetail(response);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [libraryId, assetId]);

  return detail;
}
