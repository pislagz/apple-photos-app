import { useState } from "react";
import type { MeResponse } from "../api";
import AccountMenu from "./AccountMenu";
import HiddenView from "./HiddenView";
import { Icon, type IconName } from "./icons";
import DesktopLibrary from "./library/DesktopLibrary";
import LibraryPlaceholder from "./LibraryPlaceholder";
import type { LayoutOverride } from "./useLayout";

// SPEC.md "Desktop layout: macOS Sequoia Photos" sidebar sections. Only
// "Library" has a real screen behind it until later phases; the rest are
// disabled chrome so the frame matches the reference.
const SECTIONS: { label: string; icon: IconName }[] = [
  { label: "Favorites", icon: "favorite" },
  { label: "Recently Added", icon: "added" },
  { label: "Map", icon: "map" },
  { label: "People", icon: "people" },
];
const MEDIA_TYPES: { label: string; icon: IconName }[] = [
  { label: "Videos", icon: "video" },
  { label: "Selfies", icon: "camera" },
  { label: "Live Photos", icon: "livephoto" },
  { label: "Portrait", icon: "portrait" },
  { label: "Panoramas", icon: "panorama" },
  { label: "Screenshots", icon: "screenshot" },
  { label: "RAW", icon: "document" },
];
const SMART_ALBUMS: { label: string; icon: IconName }[] = [
  { label: "Favorites", icon: "favorite" },
  { label: "Videos", icon: "video" },
  { label: "Selfies", icon: "camera" },
  { label: "Live Photos", icon: "livephoto" },
  { label: "Panoramas", icon: "panorama" },
  { label: "Screenshots", icon: "screenshot" },
  { label: "Recently Added", icon: "added" },
];
// Sequoia Photos' "Utilities" group. Only "Hidden" (P1.13) has a real screen
// behind it; "Imports" and "Recently Deleted" stay disabled chrome.
const UTILITIES: { label: string; icon: IconName }[] = [
  { label: "Imports", icon: "tray" },
  { label: "Recently Deleted", icon: "trash" },
];

export default function DesktopShell({
  me,
  layoutOverride,
  onLayoutOverrideChange,
  onLogout,
  deepLinkAssetId,
  onDeepLinkConsumed,
}: {
  me: MeResponse;
  layoutOverride: LayoutOverride;
  onLayoutOverrideChange: (value: LayoutOverride) => void;
  onLogout: () => void;
  deepLinkAssetId?: string;
  onDeepLinkConsumed?: () => void;
}) {
  const libraryName = me.libraries[0]?.display_name ?? "Library";
  const libraryId = me.libraries[0]?.id;
  const [view, setView] = useState<"library" | "hidden">("library");

  return (
    <div className="shell shell--desktop">
      <aside className="sidebar">
        <div className="sidebar__library-switcher" aria-label="Library switcher">
          {libraryName}
        </div>
        <nav aria-label="Sections">
          <ul>
            <li>
              <button
                type="button"
                aria-current={view === "library" ? "page" : undefined}
                className="sidebar__item"
                onClick={() => setView("library")}
              >
                <Icon name="library" className="sidebar__icon" />
                Library
              </button>
            </li>
            {SECTIONS.map((section) => (
              <li key={section.label}>
                <button type="button" disabled className="sidebar__item">
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
                <button type="button" disabled className="sidebar__item sidebar__item--sub">
                  <Icon name={type.icon} className="sidebar__icon" />
                  {type.label}
                </button>
              </li>
            ))}
          </ul>
        </details>
        <details className="sidebar__group" open>
          <summary>Albums</summary>
          <ul>
            <li>
              <button type="button" disabled className="sidebar__item sidebar__item--sub">
                <Icon name="folder" className="sidebar__icon" />
                My Albums
              </button>
            </li>
            {SMART_ALBUMS.map((album) => (
              <li key={album.label}>
                <button type="button" disabled className="sidebar__item sidebar__item--sub">
                  <Icon name={album.icon} className="sidebar__icon" />
                  {album.label}
                </button>
              </li>
            ))}
          </ul>
        </details>
        <details className="sidebar__group" open>
          <summary>Utilities</summary>
          <ul>
            <li>
              <button
                type="button"
                aria-current={view === "hidden" ? "page" : undefined}
                className="sidebar__item"
                onClick={() => setView("hidden")}
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
      </aside>
      <div className="shell__main">
        {view === "hidden" ? (
          <>
            <header className="toolbar">
              <h1>Hidden</h1>
            </header>
            <main className="shell__content">
              {libraryId !== undefined && <HiddenView libraryId={libraryId} />}
            </main>
          </>
        ) : (
          <main className="shell__content">
            {libraryId !== undefined ? (
              <DesktopLibrary
                libraryId={libraryId}
                initialAssetId={deepLinkAssetId}
                onInitialAssetOpened={onDeepLinkConsumed}
              />
            ) : (
              <LibraryPlaceholder />
            )}
          </main>
        )}
      </div>
    </div>
  );
}
