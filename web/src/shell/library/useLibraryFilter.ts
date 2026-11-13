import { useCallback, useMemo, useState } from "react";
import type { AssetFilter, AssetHide } from "../../api";

// Filter By + "Show" toggles, shared by the iPhone and desktop Library so
// both menus offer the same choices and send the same query.
export const FILTER_OPTIONS: { key: AssetFilter; label: string }[] = [
  { key: "all", label: "All Items" },
  { key: "favorites", label: "Favorites" },
  { key: "edited", label: "Edited" },
  { key: "photos", label: "Photos" },
  { key: "videos", label: "Videos" },
  { key: "screenshots", label: "Screenshots" },
  { key: "shared", label: "Shared with You" },
  { key: "not-in-album", label: "Not in an Album" },
];

export interface ShowToggles {
  screenshots: boolean;
  shared: boolean;
}

export const DEFAULT_SHOW: ShowToggles = { screenshots: true, shared: true };

// A kind that is the chosen filter is never hidden: "Screenshots" with the
// Screenshots toggle off would otherwise always be an empty grid.
export function hiddenKinds(filter: AssetFilter, show: ShowToggles): AssetHide[] {
  const hide: AssetHide[] = [];
  if (!show.screenshots && filter !== "screenshots") hide.push("screenshots");
  if (!show.shared && filter !== "shared") hide.push("shared");
  return hide;
}

export interface LibraryFilterState {
  filter: AssetFilter;
  show: ShowToggles;
  hide: AssetHide[];
  // True when anything differs from the defaults (button shows its active state).
  active: boolean;
  setFilter: (next: AssetFilter) => void;
  setShow: (kind: keyof ShowToggles, value: boolean) => void;
}

export function useLibraryFilter(): LibraryFilterState {
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [show, setShowState] = useState<ShowToggles>(DEFAULT_SHOW);
  const hide = useMemo(() => hiddenKinds(filter, show), [filter, show]);
  const setShow = useCallback(
    (kind: keyof ShowToggles, value: boolean) => setShowState((previous) => ({ ...previous, [kind]: value })),
    [],
  );
  return {
    filter,
    show,
    hide,
    active: filter !== "all" || !show.screenshots || !show.shared,
    setFilter,
    setShow,
  };
}
