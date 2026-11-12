import { useEffect, useRef, useState } from "react";
import { type MeResponse, PERSON_PREFIX, PLACE_PREFIX, SEARCH_PREFIX } from "../api";
import MapView, { boundsParam } from "./map/MapView";
import PeopleGrid from "./people/PeopleGrid";
import AlbumsSidebarGroup from "./albums/AlbumsSidebarGroup";
import { useAlbums } from "./albums/useAlbums";
import AccountMenu from "./AccountMenu";
import { HiddenSession, HiddenUnlock } from "./HiddenUnlock";
import HiddenView from "./HiddenView";
import { Icon, type IconName } from "./icons";
import DesktopLibrary from "./library/DesktopLibrary";
import LibraryUpdating from "./LibraryUpdating";
import { LibraryNoteFrame } from "./library/LibraryUpdatedNote";
import LibrarySwitcher from "./LibrarySwitcher";
import SearchField from "./search/SearchField";
import { useDebounced } from "./search/useDebounced";
import type { LayoutOverride } from "./useLayout";
import WelcomeScreen from "./WelcomeScreen";

const SIDEBAR_KEY = "photos-viewer.sidebar-collapsed";
function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

// SPEC.md "Desktop layout: macOS Sequoia Photos" sidebar sections. Library
// and Days (#127) have real screens; the rest is disabled chrome so the frame
// matches the reference.
// P2.1: items with a `smart` slug open the server's `smart:<slug>` album;
// the rest stay disabled until their phase.
// P2.2: "People & Pets" opens the People grid (`view` "people").
// P2.3: "Map" opens the map (`view` "map"); a pin opens its photos as a
// `place:` album with a Back button, like a person.
const SECTIONS: { label: string; icon: IconName; smart?: string; people?: boolean; map?: boolean }[] = [
  { label: "Favorites", icon: "favorite", smart: "favorites" },
  { label: "Recently Added", icon: "added", smart: "recently-added" },
  { label: "Map", icon: "map", map: true },
  { label: "People & Pets", icon: "people", people: true },
];
const MEDIA_TYPES: { label: string; icon: IconName; smart: string }[] = [
  { label: "Videos", icon: "video", smart: "videos" },
  { label: "Selfies", icon: "camera", smart: "selfies" },
  { label: "Live Photos", icon: "livephoto", smart: "live-photos" },
  { label: "Portrait", icon: "portrait", smart: "portrait" },
  { label: "Panoramas", icon: "panorama", smart: "panoramas" },
  { label: "Screenshots", icon: "screenshot", smart: "screenshots" },
  { label: "RAW", icon: "document", smart: "raw" },
];
// Sequoia Photos' "Utilities" group. Only "Hidden" (P1.13) has a real screen
// behind it; "Imports" stays disabled chrome. No Recently Deleted: deleted
// items are excluded by design (#128).
const UTILITIES: { label: string; icon: IconName }[] = [{ label: "Imports", icon: "tray" }];

// Media Types and Albums share one /albums request. Like /albums itself, a
// media type with no items is not listed; while loading or on failure none is
// (the Albums group shows the failure with Retry).
function SidebarAlbumGroups({
  libraryId,
  currentId,
  onOpen,
}: {
  libraryId: number;
  currentId: string | null;
  onOpen: (id: string, title: string) => void;
}) {
  const state = useAlbums(libraryId);
  const present = new Set(state.albums?.smart.map((album) => album.id));
  const types = MEDIA_TYPES.filter((type) => present.has(`smart:${type.smart}`));
  return (
    <>
      {types.length > 0 && (
        <details className="sidebar__group" open>
          <summary>Media Types</summary>
          <ul>
            {types.map((type) => (
              <li key={type.label}>
                <button
                  type="button"
                  aria-current={currentId === `smart:${type.smart}` ? "page" : undefined}
                  className="sidebar__item sidebar__item--sub"
                  onClick={() => onOpen(`smart:${type.smart}`, type.label)}
                >
                  <Icon name={type.icon} className="sidebar__icon" filled={currentId === `smart:${type.smart}`} />
                  {type.label}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="sidebar__group" open>
        <summary>Albums</summary>
        <AlbumsSidebarGroup state={state} currentId={currentId} onOpen={onOpen} />
      </details>
    </>
  );
}

export default function DesktopShell({
  me,
  activeLibraryId,
  onActiveLibraryChange,
  layoutOverride,
  onLayoutOverrideChange,
  onLogout,
  deepLinkAssetId,
  onDeepLinkConsumed,
  onNoteDismissed,
}: {
  me: MeResponse;
  activeLibraryId?: number;
  onActiveLibraryChange: (id: number) => void;
  layoutOverride: LayoutOverride;
  onLayoutOverrideChange: (value: LayoutOverride) => void;
  onLogout: () => void;
  deepLinkAssetId?: string;
  onDeepLinkConsumed?: () => void;
  onNoteDismissed?: () => void;
}) {
  const [view, setView] = useState<"library" | "days" | "hidden" | "album" | "people" | "map">("library");
  // P2.1: the album (user album uuid or `smart:<slug>`) shown when view is "album".
  const [album, setAlbum] = useState<{ id: string; title: string } | null>(null);
  // #130: Hidden opens only after a password prompt; cancel stays on `view`.
  // #152: one-shot start state for the Library opened from a Days double-click.
  // Cleared on the next sidebar choice; tied to a library so a switch drops it.
  const [dayStart, setDayStart] = useState<{ libraryId: number; assetId: string } | null>(null);
  // P2.2: a person is an `album` whose id is `person:<uuid>`; Back returns to the grid.
  const showingPerson = view === "album" && album?.id.startsWith(PERSON_PREFIX);
  const showingPlace = view === "album" && album?.id.startsWith(PLACE_PREFIX);
  const showingSearch = view === "album" && album?.id.startsWith(SEARCH_PREFIX);
  // P2.4: the toolbar search field. A settled, non-empty query shows its
  // results as a `search:` album; emptying the field goes back to Library.
  const [searchText, setSearchText] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const showingSearchRef = useRef(false);
  showingSearchRef.current = !!showingSearch;
  const settledQuery = useDebounced(searchText.trim());
  useEffect(() => {
    if (settledQuery) {
      setDayStart(null);
      setAlbum((current) =>
        current?.id === `${SEARCH_PREFIX}${settledQuery}`
          ? current
          : { id: `${SEARCH_PREFIX}${settledQuery}`, title: `Results for \u201c${settledQuery}\u201d` },
      );
      setView("album");
    } else if (showingSearchRef.current) {
      setAlbum(null);
      setView("library");
    }
  }, [settledQuery]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const slash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing;
      if (slash || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f")) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  // Bumped by every sidebar choice so clicking "Library" while already on
  // Library > All Photos (from a Days double-click) remounts it back to Years (#167).
  const [selectNonce, setSelectNonce] = useState(0);
  function selectView(next: "library" | "days" | "hidden" | "people" | "map") {
    setSelectNonce((n) => n + 1);
    setDayStart(null);
    setAlbum(null);
    setSearchText("");
    setView(next);
  }
  function openAlbum(id: string, title: string) {
    setDayStart(null);
    setAlbum({ id, title });
    setSearchText("");
    setView("album");
  }
  const currentAlbumId =
    view === "album" && !showingPerson && !showingPlace && !showingSearch ? (album?.id ?? null) : null;
  const [unlockPrompt, setUnlockPrompt] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, current ? "0" : "1");
      } catch {
        /* storage unavailable: the choice just doesn't persist */
      }
      return !current;
    });
  }

  const activeLibrary = me.libraries.find((library) => library.id === activeLibraryId);
  return (
    <div className={`shell shell--desktop${sidebarCollapsed ? " shell--sidebar-collapsed" : ""}`}>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={toggleSidebar}
        aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        aria-expanded={!sidebarCollapsed}
        aria-controls="app-sidebar"
      >
        <Icon name="sidebar" size={16} />
      </button>
      {/* inert while collapsed: the width animates to 0 but the links must
          leave the Tab order and the accessibility tree. */}
      <aside className="sidebar" id="app-sidebar" aria-label="Sidebar" inert={sidebarCollapsed}>
        <nav aria-label="Sections">
          <ul>
            <li>
              <button
                type="button"
                aria-current={view === "library" ? "page" : undefined}
                className="sidebar__item"
                onClick={() => selectView("library")}
              >
                <Icon name="library" className="sidebar__icon" filled={view === "library"} />
                Library
              </button>
            </li>
            <li>
              <button
                type="button"
                aria-current={view === "days" ? "page" : undefined}
                className="sidebar__item"
                onClick={() => selectView("days")}
              >
                <Icon name="days" className="sidebar__icon" filled={view === "days"} />
                Days
              </button>
            </li>
            {SECTIONS.map((section) => (
              <li key={section.label}>
                <button
                  type="button"
                  disabled={!section.smart && !section.people && !section.map}
                  aria-current={
                    section.map
                      ? view === "map" || showingPlace
                        ? "page"
                        : undefined
                      : section.people
                      ? view === "people" || showingPerson
                        ? "page"
                        : undefined
                      : section.smart && currentAlbumId === `smart:${section.smart}`
                        ? "page"
                        : undefined
                  }
                  className="sidebar__item"
                  onClick={
                    section.map
                      ? () => selectView("map")
                      : section.people
                      ? () => selectView("people")
                      : section.smart
                        ? () => openAlbum(`smart:${section.smart}`, section.label)
                        : undefined
                  }
                >
                  <Icon
                    name={section.icon}
                    className="sidebar__icon"
                    filled={
                      section.map
                        ? view === "map" || showingPlace
                        : section.people
                          ? view === "people" || showingPerson
                          : !!section.smart && currentAlbumId === `smart:${section.smart}`
                    }
                  />
                  {section.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {activeLibraryId !== undefined && !activeLibrary?.updating ? (
          <SidebarAlbumGroups
            key={activeLibraryId}
            libraryId={activeLibraryId}
            currentId={currentAlbumId}
            onOpen={openAlbum}
          />
        ) : (
          <details className="sidebar__group" open>
            <summary>Albums</summary>
            <p className="sidebar__note">No albums</p>
          </details>
        )}
        <details className="sidebar__group" open>
          <summary>Utilities</summary>
          <ul>
            <li>
              <button
                type="button"
                aria-current={view === "hidden" ? "page" : undefined}
                className="sidebar__item"
                onClick={() => view !== "hidden" && setUnlockPrompt(true)}
              >
                <Icon name="hidden" className="sidebar__icon" filled={view === "hidden"} />
                Hidden
              </button>
            </li>
            {UTILITIES.map((item) => (
              <li key={item.label}>
                <button type="button" disabled className="sidebar__item">
                  <Icon name={item.icon} className="sidebar__icon" />
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </details>
        <AccountMenu
          me={me}
          layoutOverride={layoutOverride}
          onLayoutOverrideChange={onLayoutOverrideChange}
          onLogout={onLogout}
          compact
          variant="row"
        />
        <LibrarySwitcher
          libraries={me.libraries}
          activeLibraryId={activeLibraryId}
          onChange={onActiveLibraryChange}
          className="sidebar__library-switcher"
        />
      </aside>
      <div className="shell__main">
        {/* #291: one stable slot at the right end of the toolbar row (every
            view's toolbar reserves room for it), so the input keeps focus
            while typing swaps the view underneath. */}
        <div className="shell__search">
          <SearchField ref={searchRef} variant="desktop" value={searchText} onChange={setSearchText} />
        </div>
        {view === "hidden" ? (
          <HiddenSession>
            <header className="toolbar">
              <h1>Hidden</h1>
            </header>
            <main className="shell__content">
              {activeLibraryId !== undefined && <HiddenView libraryId={activeLibraryId} variant="desktop" onCancel={() => setView("library")} />}
            </main>
          </HiddenSession>
        ) : (
          <>
            {view === "album" && album && (
              <header className="toolbar">
                {showingPlace && (
                  <button type="button" className="toolbar-button" onClick={() => selectView("map")}>
                    <Icon name="chevron" className="toolbar-button__back-icon" />
                    Map
                  </button>
                )}
                {showingPerson && (
                  <button type="button" className="toolbar-button" onClick={() => selectView("people")}>
                    <Icon name="chevron" className="toolbar-button__back-icon" />
                    People & Pets
                  </button>
                )}
                <h1>{album.title}</h1>
              </header>
            )}
            {view === "people" && (
              <header className="toolbar">
                <h1>People & Pets</h1>
              </header>
            )}
            {view === "map" && (
              <header className="toolbar">
                <h1>Map</h1>
              </header>
            )}
          <main className="shell__content">
            {(view === "library" || view === "days") && <h1 className="sr-only">{view === "days" ? "Days" : "Library"}</h1>}
            {activeLibrary?.updating ? (
              <LibraryUpdating name={activeLibrary.display_name} reason={activeLibrary.updating_reason} />
            ) : activeLibraryId !== undefined && view === "map" ? (
              <MapView
                key={activeLibraryId}
                libraryId={activeLibraryId}
                onOpenPlace={(b) => openAlbum(`${PLACE_PREFIX}${boundsParam(b)}`, "Photos here")}
              />
            ) : activeLibraryId !== undefined && view === "people" ? (
              <div className="people-desktop">
                <PeopleGrid
                  key={activeLibraryId}
                  libraryId={activeLibraryId}
                  onOpen={(person) => openAlbum(`${PERSON_PREFIX}${person.id}`, person.label)}
                />
              </div>
            ) : activeLibraryId !== undefined ? (
              <LibraryNoteFrame
                libraryId={activeLibraryId}
                note={view === "library" || view === "days" ? activeLibrary?.updated_note : null}
                variant="desktop"
                onDismissed={onNoteDismissed}
              >
              <DesktopLibrary
                key={`${activeLibraryId}-${view}-${album?.id ?? ""}-${selectNonce}`}
                album={view === "album" ? album?.id : undefined}
                isAdmin={me.role === "admin"}
                fixedView={view === "days" ? "days" : view === "album" ? "all" : undefined}
                onOpenDay={
                  view === "days"
                    ? (id) => {
                        setDayStart({ libraryId: activeLibraryId, assetId: id });
                        setView("library");
                      }
                    : undefined
                }
                initialView={dayStart?.libraryId === activeLibraryId ? "all" : undefined}
                initialScrollAssetId={dayStart?.libraryId === activeLibraryId ? dayStart.assetId : undefined}
                libraryId={activeLibraryId}
                initialAssetId={deepLinkAssetId}
                onInitialAssetOpened={onDeepLinkConsumed}
              />
              </LibraryNoteFrame>
            ) : (
              <WelcomeScreen isAdmin={me.role === "admin"} />
            )}
          </main>
          </>
        )}
      </div>
      {unlockPrompt && (
        <HiddenUnlock
          variant="desktop"
          onUnlocked={() => {
            setUnlockPrompt(false);
            setView("hidden");
          }}
          onCancel={() => setUnlockPrompt(false)}
        />
      )}
    </div>
  );
}
