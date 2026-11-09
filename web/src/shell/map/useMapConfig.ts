import { useCallback, useEffect, useState } from "react";
import { getMapConfig, type MapConfig } from "../../api";

// The admin's `Map tiles` choice, fetched when a map view mounts.
export function useMapConfig(): { config: MapConfig | null; error: boolean; retry: () => void } {
  const [config, setConfig] = useState<MapConfig | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setConfig(null);
    setError(false);
    let cancelled = false;
    getMapConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { config, error, retry };
}
