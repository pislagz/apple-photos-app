import { useCallback, useEffect, useState } from "react";
import { getSummary, type SummaryResponse } from "../../api";

export interface LibrarySummaryState {
  summary: SummaryResponse | null;
  // #147: set when `/summary` fails, so Years/Months can say so and offer Retry.
  error: boolean;
  retry: () => void;
}

// #91: Years and Months tiles come from one `/summary` call per library,
// never from paging `/assets` -- unlike Days and All Photos, which keep
// using `useLibraryAssets`.
export function useLibrarySummary(libraryId: number): LibrarySummaryState {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setSummary(null);
    setError(false);
    let cancelled = false;
    getSummary(libraryId)
      .then((response) => {
        if (!cancelled) setSummary(response);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { summary, error, retry };
}
