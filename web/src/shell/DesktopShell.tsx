import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback, useEffect, useRef, useState } from "react";
import { type MeResponse, PERSON_PREFIX, PLACE_PREFIX, SEARCH_PREFIX } from "../api";
import MapView, { boundsParam } from "./map/MapView";
import AlbumsOverview from "./albums/AlbumsOverview";
import PeopleGrid from "./people/PeopleGrid";
import AlbumsSidebarGroup from "./albums/AlbumsSidebarGroup";
import { useAlbums } from "./albums/useAlbums";
import MacAccountMenu from "./MacAccountMenu";
import { HiddenSession, HiddenUnlock } from "./HiddenUnlock";
import HiddenView from "./HiddenView";
import { Icon, type IconName } from "./icons";
import DesktopLibrary from "./library/DesktopLibrary";
import LibraryUpdating from "./LibraryUpdating";
import { LibraryNoteFrame } from "./library/LibraryUpdatedNote";
import DesktopSearch from "./search/DesktopSearch";
import { useSearchModel } from "./search/useSearchModel";
import { useDebounced } from "./search/useDebounced";
import { clampSidebarWidth, readSidebarWidth, SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_DEFAULT, writeSidebarWidth } from "./sidebarWidth";
import { effectiveSidebarCollapsed, isNarrow, isSidebarShortcut, toggleUserCollapsed } from "./sidebarAuto";
import { isTypingTarget, shortcutAction } from "./shortcuts";
import type { AlbumsState } from "./albums/useAlbums";
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
// has a real screen; the rest is disabled chrome or opens a smart album.
// P2.1: items with a `smart` slug open the server's `smart:<slug>` album.
// P2.2: "People & Pets" opens the People grid (`view` "people").
// P2.3: "Map" opens the map (`view` "map"); a pin opens its photos as a
// `place:` album with a Back button, like a person.
// #217: Days has no sidebar entry; the toolbar switches Years/Months/All.
type SectionItem = { label: string; icon: IconName; smart?: string; people?: boolean; map?: boolean; albums?: boolean; library?: boolean };
const PHOTOS_SECTION: SectionItem[] = [
  { label: "Library", icon: "library", library: true },
  { label: "Recently Added", icon: "added", smart: "recently-added" },
  { label: "Favorites", icon: "favorite", smart: "favorites" },
];
const COLLECTIONS_SECTION: SectionItem[] = [
  { label: "People & Pets", icon: "people", people: true },
  { label: "Map", icon: "map", map: true },
  { label: "Albums", icon: "albums", albums: true },
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

// Sentence-case section title; the chevron only shows on hover or focus (CSS).
function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="sidebar__group" open>
      <summary>
        <span>{title}</span>
        <Icon name="chevron" size={8} className="sidebar__group-chevron" />
      </summary>
      {children}
    </details>
  );
}

// Only media types that have items are listed. While /albums loads (or when it
// failed; the Albums group shows the failure with Retry) the group is absent
// rather than flashing all seven rows.
function MediaTypesGroup({
  state,
  currentId,
  onOpen,
}: {
  state: AlbumsState;
  currentId: string | null;
  onOpen: (id: string, title: string) => void;
}) {
  const counts = new Map(state.albums?.smart.map((album) => [album.id, album.count ?? 0]));
  const types = MEDIA_TYPES.filter((type) => (counts.get(`smart:${type.smart}`) ?? 0) > 0);
  if (types.length === 0) return null;
  return (
    <SidebarSection title="Media types">
      <ul>
        {types.map((type) => {
          const id = `smart:${type.smart}`;
          return (
            <li key={type.label}>
              <button
                type="button"
                aria-current={currentId === id ? "page" : undefined}
                className="sidebar__item"
                onClick={() => onOpen(id, type.label)}
              >
                <Icon name={type.icon} className="sidebar__icon" filled={currentId === id} />
                {type.label}
              </button>
            </li>
          );
        })}
      </ul>
    </SidebarSection>
  );
}

// One /albums request feeds the Media types group (above Utilities) and the
// user albums group (below it).
function SidebarAlbumData({
  libraryId,
  children,
}: {
  libraryId: number;
  children: (state: AlbumsState) => ReactNode;
}) {
  return <>{children(useAlbums(libraryId))}</>;
}

function PageHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-heading">
      <div className="page-heading__text">
        <h1 className="page-heading__title">{title}</h1>
        <p className="page-heading__subtitle">{"\u00a0"}</p>
      </div>
      {children}
    </div>
  );
}

export default function DesktopShell({
  me,
  activeLibraryId,
  onActiveLibraryChange,
  onLogout,
  deepLinkAssetId,
  onDeepLinkConsumed,
  onNoteDismissed,
  onAvatarChanged,
}: {
  me: MeResponse;
  activeLibraryId?: number;
  onActiveLibraryChange: (id: number) => void;
  onLogout: () => void;
  deepLinkAssetId?: string;
  onDeepLinkConsumed?: () => void;
  onNoteDismissed?: () => void;
  onAvatarChanged?: () => void;
}) {
  const [view, setView] = useState<"library" | "hidden" | "album" | "people" | "map" | "albums">("library");
  // P2.1: the album (user album uuid or `smart:<slug>`) shown when view is "album".
  const [album, setAlbum] = useState<{ id: string; title: string; count?: number | null; fromOverview?: boolean } | null>(
    null,
  );
  // #130: Hidden opens only after a password prompt; cancel stays on `view`.
  // P2.2: a person is an `album` whose id is `person:<uuid>`; Back returns to the grid.
  const showingPerson = view === "album" && album?.id.startsWith(PERSON_PREFIX);
  const showingPlace = view === "album" && album?.id.startsWith(PLACE_PREFIX);
  const showingSearch = view === "album" && album?.id.startsWith(SEARCH_PREFIX);
  // P2.4: the toolbar search field. A settled, non-empty query shows its
  // results as a `search:` album; emptying the field goes back to Library.
  const search = useSearchModel(activeLibraryId ?? -1);
  const searchRef = useRef<HTMLInputElement>(null);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const showingSearchRef = useRef(false);
  showingSearchRef.current = !!showingSearch;
  const [searchCount, setSearchCount] = useState<{ count: number; done: boolean } | null>(null);
  const onSearchCount = useCallback(
    (count: number, done: boolean) =>
      setSearchCount((c) => (c && c.count === count && c.done === done ? c : { count, done })),
    [],
  );
  const applyQuery = useCallback((query: string) => {
    if (query) {
      setAlbum((current) =>
        current?.id === `${SEARCH_PREFIX}${query}`
          ? current
          : { id: `${SEARCH_PREFIX}${query}`, title: `Results for \u201c${query}\u201d` },
      );
      setView("album");
    } else if (showingSearchRef.current) {
      setAlbum(null);
      setView("library");
    }
  }, []);
  // The field settles after a short pause; Enter and a chosen row run at once.
  const settledQuery = useDebounced(search.query);
  useEffect(() => applyQuery(settledQuery), [settledQuery, applyQuery]);
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
  // Library > All Photos remounts it back to Years (#167).
  const [selectNonce, setSelectNonce] = useState(0);
  function selectView(next: "library" | "hidden" | "people" | "map" | "albums") {
    setSelectNonce((n) => n + 1);
    setAlbum(null);
    search.clear();
    setView(next);
  }
  function openAlbum(id: string, title: string, extra?: { count?: number | null; fromOverview?: boolean }) {
    setAlbum({ id, title, ...extra });
    search.clear();
    setView("album");
  }
  const itemsLabel = (n: number, more = false) => `${n.toLocaleString()}${more ? "+" : ""} ${n === 1 && !more ? "item" : "items"}`;
  const headingSubtitle =
    view === "album" && !showingSearch && album?.count != null
      ? itemsLabel(album.count)
      : showingSearch && searchCount && (searchCount.done || searchCount.count > 0)
        ? itemsLabel(searchCount.count, !searchCount.done)
        : undefined;
  const backToAlbums = view === "album" && !!album?.fromOverview;
  // Cmd [ (Ctrl [ elsewhere) goes back from a place, person or an album opened
  // on the Albums screen. An open Viewer takes it first (it closes).
  const backTo = showingPlace ? "map" : showingPerson ? "people" : backToAlbums ? "albums" : null;
  useEffect(() => {
    if (!backTo) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target) || shortcutAction(event) !== "back") return;
      event.preventDefault();
      selectView(backTo as "map" | "people" | "albums");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [backTo]);
  const currentAlbumId =
    view === "album" && !showingPerson && !showingPlace && !showingSearch ? (album?.id ?? null) : null;
  const [unlockPrompt, setUnlockPrompt] = useState(false);

  const [userCollapsed, setUserCollapsed] = useState(readSidebarCollapsed);
  const [narrow, setNarrow] = useState(() => isNarrow(window.innerWidth));
  useEffect(() => {
    const onResize = () => setNarrow(isNarrow(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const sidebarCollapsed = effectiveSidebarCollapsed(userCollapsed, narrow);
  const toggleSidebar = useCallback(() => {
    if (narrow) return;
    setUserCollapsed((current) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, current ? "0" : "1");
      } catch {
        /* storage unavailable: the choice just doesn't persist */
      }
      return toggleUserCollapsed(current, false);
    });
  }, [narrow]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSidebarShortcut(event) || isTypingTarget(event.target)) return;
      event.preventDefault();
      toggleSidebar();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [resizing, setResizing] = useState(false);
  function commitSidebarWidth(width: number) {
    const next = clampSidebarWidth(width);
    setSidebarWidth(next);
    writeSidebarWidth(next);
  }
  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture?.(event.pointerId);
    const left = handle.parentElement?.getBoundingClientRect().left ?? 0;
    setResizing(true);
    let last = sidebarWidth;
    function move(e: PointerEvent) {
      last = clampSidebarWidth(e.clientX - left);
      setSidebarWidth(last);
    }
    function end() {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setResizing(false);
      writeSidebarWidth(last);
    }
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  function resizeKey(event: ReactKeyboardEvent) {
    const step = event.shiftKey ? 30 : 10;
    if (event.key === "ArrowLeft") commitSidebarWidth(sidebarWidth - step);
    else if (event.key === "ArrowRight") commitSidebarWidth(sidebarWidth + step);
    else if (event.key === "Home") commitSidebarWidth(SIDEBAR_MIN);
    else if (event.key === "End") commitSidebarWidth(SIDEBAR_MAX);
    else return;
    event.preventDefault();
  }

  const activeLibrary = me.libraries.find((library) => library.id === activeLibraryId);
  function renderItem(section: SectionItem) {
    const current = section.library
      ? view === "library"
      : section.albums
        ? view === "albums" || backToAlbums
        : section.map
          ? view === "map" || !!showingPlace
          : section.people
            ? view === "people" || !!showingPerson
            : !!section.smart && currentAlbumId === `smart:${section.smart}`;
    const onClick = section.library
      ? () => selectView("library")
      : section.albums
        ? () => selectView("albums")
        : section.map
          ? () => selectView("map")
          : section.people
            ? () => selectView("people")
            : section.smart
              ? () => openAlbum(`smart:${section.smart}`, section.label)
              : undefined;
    return (
      <li key={section.label}>
        <button
          type="button"
          disabled={!onClick}
          aria-current={current ? "page" : undefined}
          className="sidebar__item"
          onClick={onClick}
        >
          <Icon name={section.icon} className="sidebar__icon" filled={current} />
          {section.label}
        </button>
      </li>
    );
  }
  const utilities = (
    <SidebarSection title="Utilities">
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
    </SidebarSection>
  );

  return (
    <div
      className={`shell shell--desktop${sidebarCollapsed ? " shell--sidebar-collapsed" : ""}${resizing ? " shell--resizing" : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <button
        type="button"
        className="sidebar-toggle"
        onClick={toggleSidebar}
        disabled={narrow}
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
          <SidebarSection title="Photos">
            <ul>{PHOTOS_SECTION.map(renderItem)}</ul>
          </SidebarSection>
          <SidebarSection title="Collections">
            <ul>{COLLECTIONS_SECTION.map(renderItem)}</ul>
          </SidebarSection>
        </nav>
        {activeLibraryId !== undefined && !activeLibrary?.updating ? (
          <SidebarAlbumData key={activeLibraryId} libraryId={activeLibraryId}>
            {(state) => (
              <>
                <MediaTypesGroup state={state} currentId={currentAlbumId} onOpen={openAlbum} />
                {utilities}
                <SidebarSection title="Albums">
                  <AlbumsSidebarGroup
                    state={state}
                    libraryId={activeLibraryId}
                    currentId={currentAlbumId}
                    onOpen={openAlbum}
                  />
                </SidebarSection>
              </>
            )}
          </SidebarAlbumData>
        ) : (
          <>
            {utilities}
            <SidebarSection title="Albums">
              <p className="sidebar__note">No albums</p>
            </SidebarSection>
          </>
        )}
        <MacAccountMenu
          onAvatarChanged={onAvatarChanged}
          me={me}
          onLogout={onLogout}
          libraries={me.libraries}
          activeLibraryId={activeLibraryId}
          onActiveLibraryChange={onActiveLibraryChange}
        />
      </aside>
      {!sidebarCollapsed && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={resizeKey}
          onDoubleClick={() => commitSidebarWidth(SIDEBAR_DEFAULT)}
        />
      )}
      <div className="shell__main">
        {/* #296: ONE fixed toolbar row for every view, like Photos for Mac:
            back button and the view's controls on the left (DesktopLibrary
            portals its controls into the slot), search at the right end, so
            the field keeps the same box everywhere and keeps focus while
            typing swaps the view underneath. The page title is a heading
            below this row, never inside it. */}
        <header className="shell__toolbar" data-testid="shell-toolbar">
          <div className="shell__toolbar-nav">
            {view === "album" && showingPlace && (
              <button type="button" className="toolbar-button" onClick={() => selectView("map")}>
                <Icon name="chevron" className="toolbar-button__back-icon" />
                Map
              </button>
            )}
            {view === "album" && backToAlbums && (
              <button type="button" className="toolbar-button" onClick={() => selectView("albums")} title="Back (⌘[)">
                <Icon name="chevron" className="toolbar-button__back-icon" />
                Albums
              </button>
            )}
            {view === "album" && showingPerson && (
              <button type="button" className="toolbar-button" onClick={() => selectView("people")}>
                <Icon name="chevron" className="toolbar-button__back-icon" />
                People & Pets
              </button>
            )}
          </div>
          <div className="shell__toolbar-controls" ref={setToolbarSlot} />
          <div className="shell__search">
            <DesktopSearch ref={searchRef} model={search} onRun={applyQuery} />
          </div>
        </header>
        {view === "hidden" ? (
          <HiddenSession>
            <PageHeading title="Hidden" />
            <main className="shell__content">
              {activeLibraryId !== undefined && <HiddenView libraryId={activeLibraryId} variant="desktop" onCancel={() => setView("library")} />}
            </main>
          </HiddenSession>
        ) : (
          <>
            {view === "albums" && <PageHeading title="Albums" />}
            {view === "people" && <PageHeading title="People & Pets" />}
            {view === "map" && <PageHeading title="Map" />}
          <main className="shell__content">
            {activeLibrary?.updating ? (
              <LibraryUpdating name={activeLibrary.display_name} reason={activeLibrary.updating_reason} />
            ) : activeLibraryId !== undefined && view === "map" ? (
              <MapView
                key={activeLibraryId}
                libraryId={activeLibraryId}
                onOpenPlace={(b) => openAlbum(`${PLACE_PREFIX}${boundsParam(b)}`, "Photos here")}
              />
            ) : activeLibraryId !== undefined && view === "albums" ? (
              <AlbumsOverview
                key={activeLibraryId}
                libraryId={activeLibraryId}
                onOpen={(node) => openAlbum(node.id, node.title, { count: node.count, fromOverview: true })}
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
                note={view === "library" ? activeLibrary?.updated_note : null}
                variant="desktop"
                onDismissed={onNoteDismissed}
              >
              <DesktopLibrary
                key={`${activeLibraryId}-${view}-${album?.id ?? ""}-${selectNonce}`}
                album={view === "album" ? album?.id : undefined}
                isAdmin={me.role === "admin"}
                title={view === "album" ? album?.title : "Library"}
                subtitle={headingSubtitle}
                toolbarSlot={toolbarSlot}
                fixedView={view === "album" ? "all" : undefined}
                libraryId={activeLibraryId}
                initialAssetId={deepLinkAssetId}
                onInitialAssetOpened={onDeepLinkConsumed}
                onCount={showingSearch ? onSearchCount : undefined}
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
