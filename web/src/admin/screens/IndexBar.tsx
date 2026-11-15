import type { LibraryStatusResponse } from "../api";

/** The bar under a library that is being read for the first time (or again). */
export function IndexBar({ status }: { status: LibraryStatusResponse }) {
  if (status.index_state !== "indexing") return null;
  const progress = status.index_progress;
  const known = progress !== null && progress !== undefined && progress.total > 0;
  return (
    <progress
      aria-label="Indexing progress"
      value={known ? progress.done : undefined}
      max={known ? progress.total : undefined}
    />
  );
}
