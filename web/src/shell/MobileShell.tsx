import type { MeResponse } from "../api";
import AccountMenu from "./AccountMenu";
import { Icon, type IconName } from "./icons";
import MobileLibrary from "./library/MobileLibrary";
import LibraryPlaceholder from "./LibraryPlaceholder";
import type { LayoutOverride } from "./useLayout";

// iOS 17 Photos' tab bar: Library, Albums, People, Map (SPEC.md "Mobile
// layout"). Only Library has data behind it until Phase 2; the rest stay
// visible so the frame matches the reference, but disabled.
const TABS: { key: string; label: string; icon: IconName; active: boolean }[] = [
  { key: "library", label: "Library", icon: "library", active: true },
  { key: "albums", label: "Albums", icon: "albums", active: false },
  { key: "people", label: "People", icon: "people", active: false },
  { key: "map", label: "Map", icon: "map", active: false },
];

export default function MobileShell({
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
  return (
    <div className="shell shell--mobile">
      <header className="shell__header">
        <h1 className="sr-only">Library</h1>
        <AccountMenu
          me={me}
          layoutOverride={layoutOverride}
          onLayoutOverrideChange={onLayoutOverrideChange}
          onLogout={onLogout}
          compact
        />
      </header>
      <main className="shell__content">
        {me.libraries[0] ? (
          <MobileLibrary
            libraryId={me.libraries[0].id}
            initialAssetId={deepLinkAssetId}
            onInitialAssetOpened={onDeepLinkConsumed}
          />
        ) : (
          <LibraryPlaceholder />
        )}
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
            <Icon name={tab.icon} className="tab-bar__icon" />
            <span className="tab-bar__label">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
