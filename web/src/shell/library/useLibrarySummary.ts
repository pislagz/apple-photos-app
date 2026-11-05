import { useEffect, useState } from "react";
import { getSummary, type SummaryResponse } from "../../api";

// #91: Years and Months tiles come from one `/summary` call per library,
// never from paging `/assets` -- unlike Days and All Photos, which keep
// using `useLibraryAssets`.
export function useLibrarySummary(libraryId: number): SummaryResponse | null {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);

  useEffect(() => {
    setSummary(null);
    let cancelled = false;
    getSummary(libraryId)
      .then((response) => {
        if (!cancelled) setSummary(response);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [libraryId]);

  return summary;
}
