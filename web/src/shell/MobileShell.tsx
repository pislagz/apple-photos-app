import type { MeResponse } from "../api";
import AccountMenu from "./AccountMenu";
import MobileLibrary from "./library/MobileLibrary";
import LibraryPlaceholder from "./LibraryPlaceholder";
import type { LayoutOverride } from "./useLayout";

// iOS 17 Photos' tab bar: Library, Albums, People, Map (SPEC.md "Mobile
// layout"). Only Library has data behind it until Phase 2; the rest stay
// visible so the frame matches the reference, but disabled.
const TABS: { key: string; label: string; active: boolean }[] = [
  { key: "library", label: "Library", active: true },
  { key: "albums", label: "Albums", active: false },
  { key: "people", label: "People", active: false },
  { key: "map", label: "Map", active: false },
];

export default function MobileShell({
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
  return (
    <div className="shell shell--mobile">
      <header className="shell__header">
        <h1>Library</h1>
        <AccountMenu
          me={me}
          layoutOverride={layoutOverride}
          onLayoutOverrideChange={onLayoutOverrideChange}
          onLogout={onLogout}
        />
      </header>
      <main className="shell__content">
        {me.libraries[0] ? <MobileLibrary libraryId={me.libraries[0].id} /> : <LibraryPlaceholder />}
      </main>
      <nav className="tab-bar" aria-label="Primary">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="tab-bar__item"
            aria-current={tab.active ? "page" : undefined}
            disabled={!tab.active}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
