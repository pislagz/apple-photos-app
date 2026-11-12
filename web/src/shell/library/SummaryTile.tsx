import { useEffect, useState } from "react";
import FadeImage from "./FadeImage";

// R4: cycle a tile through its few top-scored key photos instead of
// pinning one, slowly enough to read -- not a carousel the user drives.
const CYCLE_INTERVAL_MS = 3000;

// One Years/Months tile (#91): a compact card, not a per-asset grid --
// cycles through up to `_KEY_ASSETS_PER_BUCKET` (server-side) candidates
// the `/summary` bucket already carries.
export default function SummaryTile({
  libraryId,
  label,
  count,
  keyAssetIds,
  onOpen,
}: {
  libraryId: number;
  label: string;
  count: number;
  keyAssetIds: string[];
  onOpen: () => void;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (keyAssetIds.length <= 1) return;
    const interval = setInterval(() => {
      setIndex((previous) => (previous + 1) % keyAssetIds.length);
    }, CYCLE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [keyAssetIds]);

  const assetId = keyAssetIds[index];

  return (
    <button type="button" className="mobile-library__tile" onClick={onOpen}>
      {assetId && (
        <FadeImage
          key={assetId}
          src={`/api/libraries/${libraryId}/thumb/${assetId}?size=grid2x`}
          alt={label}
          loading="lazy"
          className="mobile-library__tile-image"
        />
      )}
      <div className="mobile-library__tile-caption" aria-hidden="true">
        <span className="mobile-library__tile-label">{label}</span>
        <span className="mobile-library__tile-count">{count}</span>
      </div>
    </button>
  );
}
