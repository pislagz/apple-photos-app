import { useCallback, useEffect, useState } from "react";
import type { LibrarySummary, MeResponse } from "../api";

const STORAGE_PREFIX = "photos-viewer:active-library:";

function storageKey(username: string): string {
  return `${STORAGE_PREFIX}${username}`;
}

function readStoredId(username: string): number | undefined {
  if (typeof window === "undefined" || !username) return undefined;
  const stored = window.localStorage.getItem(storageKey(username));
  if (stored === null) return undefined;
  const id = Number(stored);
  return Number.isFinite(id) ? id : undefined;
}

function resolveActiveId(libraries: LibrarySummary[], candidate: number | undefined): number | undefined {
  if (candidate !== undefined && libraries.some((library) => library.id === candidate)) return candidate;
  return libraries[0]?.id;
}

export interface UseActiveLibraryResult {
  activeLibraryId: number | undefined;
  activeLibrary: LibrarySummary | undefined;
  setActiveLibraryId: (id: number) => void;
}

// One shared, persisted choice of which assigned library Library, Hidden,
// deep links, and future tabs all read, instead of each screen defaulting to
// `me.libraries[0]` (#90). Falls back to the account's first library
// whenever the saved id is missing or no longer in `me.libraries` (access
// revoked, or a different account on a shared browser).
export function useActiveLibrary(me: MeResponse | null): UseActiveLibraryResult {
  const username = me?.username ?? "";
  const libraries = me?.libraries ?? [];
  const [activeLibraryId, setActiveLibraryId] = useState<number | undefined>(() =>
    resolveActiveId(libraries, readStoredId(username)),
  );

  useEffect(() => {
    setActiveLibraryId((current) => resolveActiveId(libraries, current ?? readStoredId(username)));
  }, [username, libraries]);

  const setActiveLibrary = useCallback(
    (id: number) => {
      setActiveLibraryId(id);
      if (typeof window !== "undefined" && username) window.localStorage.setItem(storageKey(username), String(id));
    },
    [username],
  );

  return {
    activeLibraryId,
    activeLibrary: libraries.find((library) => library.id === activeLibraryId),
    setActiveLibraryId: setActiveLibrary,
  };
}
