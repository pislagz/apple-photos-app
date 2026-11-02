import type { MeResponse } from "../api";
import AccountMenu from "./AccountMenu";
import LibraryPlaceholder from "./LibraryPlaceholder";
import type { LayoutOverride } from "./useLayout";

// SPEC.md "Desktop layout: macOS Sequoia Photos" sidebar sections. Only
// "Library" has a real screen behind it until later phases; the rest are
// disabled chrome so the frame matches the reference.
const SECTIONS = ["Favorites", "Recently Added", "Map", "People"];
const MEDIA_TYPES = ["Videos", "Selfies", "Live Photos", "Portrait", "Panoramas", "Screenshots", "RAW"];
const SMART_ALBUMS = ["Favorites", "Videos", "Selfies", "Live Photos", "Panoramas", "Screenshots", "Recently Added"];

export default function DesktopShell({
  me,
  layoutOverride,
  onLayoutOverrideChange,
  onLogout,
}: {
  me: MeResponse;
  layoutOverride: LayoutOverride;
  onLayoutOverrideChange: (value: LayoutOverride) => void;
  onLogout: () => void;
}) {
  const libraryName = me.libraries[0]?.display_name ?? "Library";

  return (
    <div className="shell shell--desktop">
      <aside className="sidebar">
        <div className="sidebar__library-switcher" aria-label="Library switcher">
          {libraryName}
        </div>
        <nav aria-label="Sections">
          <ul>
            <li>
              <button type="button" aria-current="page" className="sidebar__item">
                Library
              </button>
            </li>
            {SECTIONS.map((section) => (
              <li key={section}>
                <button type="button" disabled className="sidebar__item">
                  {section}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <details className="sidebar__group" open>
          <summary>Media Types</summary>
          <ul>
            {MEDIA_TYPES.map((type) => (
              <li key={type}>
                <button type="button" disabled className="sidebar__item">
                  {type}
                </button>
              </li>
            ))}
          </ul>
        </details>
        <details className="sidebar__group" open>
          <summary>Albums</summary>
          <ul>
            <li>
              <button type="button" disabled className="sidebar__item">
                My Albums
              </button>
            </li>
            {SMART_ALBUMS.map((album) => (
              <li key={album}>
                <button type="button" disabled className="sidebar__item">
                  {album}
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
        />
      </aside>
      <div className="shell__main">
        <header className="toolbar">
          <h1>Library</h1>
        </header>
        <main className="shell__content">
          <LibraryPlaceholder />
        </main>
      </div>
    </div>
  );
}
