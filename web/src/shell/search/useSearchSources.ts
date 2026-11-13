import { useEffect, useState } from "react";
import { getAlbums, getPeople, getSummary } from "../../api";
import type { SearchSources } from "./searchModel";

const EMPTY: SearchSources = { people: [], albums: [], summary: null };

// Loaded once per library, when the field is first used. A call that fails
// just leaves that kind out of the suggestions; plain search still works.
export function useSearchSources(libraryId: number, enabled: boolean): SearchSources {
  const [sources, setSources] = useState<SearchSources>(EMPTY);
  useEffect(() => {
    setSources(EMPTY);
  }, [libraryId]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const part = <T,>(p: Promise<T>) => p.catch(() => null);
    Promise.all([part(getPeople(libraryId)), part(getAlbums(libraryId)), part(getSummary(libraryId))]).then(
      ([people, albums, summary]) => {
        if (cancelled) return;
        setSources({ people: people?.people ?? [], albums: albums?.tree ?? [], summary });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [libraryId, enabled]);
  return sources;
}
