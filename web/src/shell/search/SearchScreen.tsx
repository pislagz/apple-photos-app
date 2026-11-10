import { useEffect, useState } from "react";
import { SEARCH_PREFIX } from "../../api";
import MobileLibrary from "../library/MobileLibrary";
import SearchField from "./SearchField";
import { useDebounced } from "./useDebounced";

// P2.4: the phone Search tab. `/search` is the empty field, `/search/<query>`
// is a results page (deep link reload works). Results are the ordinary
// All Photos grid and Viewer; loading, empty and error + Retry come from it.
export default function SearchScreen({
  libraryId,
  query,
  onQueryChange,
}: {
  libraryId: number;
  query: string;
  // Replaces the current history entry, so typing does not pile up history.
  onQueryChange: (query: string) => void;
}) {
  const [text, setText] = useState(query);
  const debounced = useDebounced(text.trim());
  useEffect(() => {
    if (debounced !== query) onQueryChange(debounced);
    // Only a settled edit of the field moves the route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="mobile-screen">
      <header className="mobile-screen__header mobile-screen__header--root">
        <h1 className="mobile-screen__title">Search</h1>
        <SearchField variant="mobile" value={text} onChange={setText} autoFocus={!query} />
      </header>
      {query ? (
        <div className="mobile-screen__album-grid">
          <MobileLibrary key={query} libraryId={libraryId} album={`${SEARCH_PREFIX}${query}`} />
        </div>
      ) : (
        <div className="mobile-screen__body">
          <p>Search by place, person, album, date, camera, or what is in the photo, like “beach” or “dog”.</p>
        </div>
      )}
    </div>
  );
}
