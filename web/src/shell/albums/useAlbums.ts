import { useCallback, useEffect, useState } from "react";
import { type AlbumsResponse, getAlbums } from "../../api";

export interface AlbumsState {
  albums: AlbumsResponse | null;
  // Set when `/albums` fails, so the list can say so and offer Retry.
  error: boolean;
  retry: () => void;
}

// P2.1: the folder tree and smart albums, one call per library.
export function useAlbums(libraryId: number): AlbumsState {
  const [albums, setAlbums] = useState<AlbumsResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setAlbums(null);
    setError(false);
    let cancelled = false;
    getAlbums(libraryId)
      .then((response) => {
        if (!cancelled) setAlbums(response);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { albums, error, retry };
}
