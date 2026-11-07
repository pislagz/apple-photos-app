import { useState } from "react";
import type { MeResponse } from "../api";
import AccountMenu from "./AccountMenu";
import { HiddenSession, HiddenUnlock } from "./HiddenUnlock";
import HiddenView from "./HiddenView";
import { Icon, type IconName } from "./icons";
import DesktopLibrary from "./library/DesktopLibrary";
import LibraryPlaceholder from "./LibraryPlaceholder";
import LibrarySwitcher from "./LibrarySwitcher";
import type { LayoutOverride } from "./useLayout";

// SPEC.md "Desktop layout: macOS Sequoia Photos" sidebar sections. Library
// and Days (#127) have real screens; the rest is disabled chrome so the frame
// matches the reference.
const SECTIONS: { label: string; icon: IconName }[] = [
  { label: "Favorites", icon: "favorite" },
  { label: "Recently Added", icon: "added" },
  { label: "Map", icon: "map" },
  { label: "People & Pets", icon: "people" },
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
  const [view, setView] = useState<"library" | "days" | "hidden">("library");
  // #130: Hidden opens only after a password prompt; cancel stays on `view`.
  // #152: one-shot start state for the Library opened from a Days double-click.
  // Cleared on the next sidebar choice; tied to a library so a switch drops it.
  const [dayStart, setDayStart] = useState<{ libraryId: number; assetId: string } | null>(null);
  function selectView(next: "library" | "days" | "hidden") {
    setDayStart(null);
    setView(next);
  }
  const [unlockPrompt, setUnlockPrompt] = useState(false);

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
          <main className="shell__content">
            {activeLibraryId !== undefined ? (
              <DesktopLibrary
                key={`${activeLibraryId}-${view}`}
                fixedView={view === "days" ? "days" : undefined}
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
