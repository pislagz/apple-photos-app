import { useState } from "react";
import type { MeResponse } from "../api";
import AlbumsSidebarGroup from "./albums/AlbumsSidebarGroup";
import AccountMenu from "./AccountMenu";
import { HiddenSession, HiddenUnlock } from "./HiddenUnlock";
import HiddenView from "./HiddenView";
import { Icon, type IconName } from "./icons";
import DesktopLibrary from "./library/DesktopLibrary";
import LibraryPlaceholder from "./LibraryPlaceholder";
import LibraryUpdating from "./LibraryUpdating";
import LibrarySwitcher from "./LibrarySwitcher";
import type { LayoutOverride } from "./useLayout";

// SPEC.md "Desktop layout: macOS Sequoia Photos" sidebar sections. Library
// and Days (#127) have real screens; the rest is disabled chrome so the frame
// matches the reference.
// P2.1: items with a `smart` slug open the server's `smart:<slug>` album;
// the rest stay disabled until their phase.
const SECTIONS: { label: string; icon: IconName; smart?: string }[] = [
  { label: "Favorites", icon: "favorite", smart: "favorites" },
  { label: "Recently Added", icon: "added", smart: "recently-added" },
  { label: "Map", icon: "map" },
  { label: "People & Pets", icon: "people" },
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

export default function DesktopShell({
  me,
  activeLibraryId,
  onActiveLibraryChange,
  layoutOverride,
  onLayoutOverrideChange,
  onLogout,
  deepLinkAssetId,
  onDeepLinkConsumed,
}: {
  me: MeResponse;
  activeLibraryId?: number;
  onActiveLibraryChange: (id: number) => void;
  layoutOverride: LayoutOverride;
  onLayoutOverrideChange: (value: LayoutOverride) => void;
  onLogout: () => void;
  deepLinkAssetId?: string;
  onDeepLinkConsumed?: () => void;
}) {
  const [view, setView] = useState<"library" | "days" | "hidden" | "album">("library");
  // P2.1: the album (user album uuid or `smart:<slug>`) shown when view is "album".
  const [album, setAlbum] = useState<{ id: string; title: string } | null>(null);
  // #130: Hidden opens only after a password prompt; cancel stays on `view`.
  // #152: one-shot start state for the Library opened from a Days double-click.
  // Cleared on the next sidebar choice; tied to a library so a switch drops it.
  const [dayStart, setDayStart] = useState<{ libraryId: number; assetId: string } | null>(null);
  function selectView(next: "library" | "days" | "hidden") {
    setDayStart(null);
    setAlbum(null);
    setView(next);
  }
  function openAlbum(id: string, title: string) {
    setDayStart(null);
    setAlbum({ id, title });
    setView("album");
  }
  const currentAlbumId = view === "album" ? (album?.id ?? null) : null;
  const [unlockPrompt, setUnlockPrompt] = useState(false);

  const activeLibrary = me.libraries.find((library) => library.id === activeLibraryId);
  return (
    <div className="shell shell--desktop">
      <aside className="sidebar">
        <nav aria-label="Sections">
          <ul>
            <li>
              <button
                type="button"
                aria-current={view === "library" ? "page" : undefined}
                className="sidebar__item"
                onClick={() => selectView("library")}
              >
                <Icon name="library" className="sidebar__icon" />
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
                <Icon name="days" className="sidebar__icon" />
                Days
              </button>
            </li>
            {SECTIONS.map((section) => (
              <li key={section.label}>
                <button
                  type="button"
                  disabled={!section.smart}
                  aria-current={section.smart && currentAlbumId === `smart:${section.smart}` ? "page" : undefined}
                  className="sidebar__item"
                  onClick={section.smart ? () => openAlbum(`smart:${section.smart}`, section.label) : undefined}
                >
                  <Icon name={section.icon} className="sidebar__icon" />
                  {section.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <details className="sidebar__group" open>
          <summary>Media Types</summary>
          <ul>
            {MEDIA_TYPES.map((type) => (
              <li key={type.label}>
                <button
                  type="button"
                  aria-current={currentAlbumId === `smart:${type.smart}` ? "page" : undefined}
                  className="sidebar__item sidebar__item--sub"
                  onClick={() => openAlbum(`smart:${type.smart}`, type.label)}
                >
                  <Icon name={type.icon} className="sidebar__icon" />
                  {type.label}
                </button>
              </li>
            ))}
          </ul>
        </details>
        <details className="sidebar__group" open>
          <summary>Albums</summary>
          {activeLibraryId !== undefined && !activeLibrary?.updating ? (
            <AlbumsSidebarGroup
              key={activeLibraryId}
              libraryId={activeLibraryId}
              currentId={currentAlbumId}
              onOpen={openAlbum}
            />
          ) : (
            <p className="sidebar__note">No albums</p>
          )}
        </details>
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
                <Icon name="hidden" className="sidebar__icon" />
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
                <h1>{album.title}</h1>
              </header>
            )}
          <main className="shell__content">
            {activeLibrary?.updating ? (
              <LibraryUpdating name={activeLibrary.display_name} reason={activeLibrary.updating_reason} />
            ) : activeLibraryId !== undefined ? (
              <DesktopLibrary
                key={`${activeLibraryId}-${view}-${album?.id ?? ""}`}
                album={view === "album" ? album?.id : undefined}
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
            ) : (
              <LibraryPlaceholder />
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
