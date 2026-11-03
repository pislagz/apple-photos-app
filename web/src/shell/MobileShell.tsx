import { useEffect, useState } from "react";
import type { MeResponse } from "../api";
import AccountMenu from "./AccountMenu";
import HiddenView from "./HiddenView";
import { Icon, type IconName } from "./icons";
import MobileLibrary from "./library/MobileLibrary";
import LibraryPlaceholder from "./LibraryPlaceholder";
import HiddenConfirm from "./more/HiddenConfirm";
import { MEDIA_TYPES } from "./more/mediaTypes";
import MorePlaceholderScreen from "./more/MorePlaceholderScreen";
import MoreScreen from "./more/MoreScreen";
import { type MobileRoute, type MobileTab, mobileRoutePath, parseMobileRoute } from "./route";
import TabPlaceholderScreen from "./TabPlaceholderScreen";
import type { LayoutOverride } from "./useLayout";

// #125, tracker R1: Library, Albums, More, Search -- no "For You" (Apple's
// Memories and Featured Photos are curated by Apple, not in the library,
// see docs/design-refs/README.md). People, Places, Media Types, and Hidden
// move inside More instead of each getting a top-level tab.
const TABS: { key: MobileTab; label: string; icon: IconName }[] = [
  { key: "library", label: "Library", icon: "library" },
  { key: "albums", label: "Albums", icon: "albums" },
  { key: "more", label: "More", icon: "more" },
  { key: "search", label: "Search", icon: "search" },
];

export default function MobileShell({
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
  const [route, setRoute] = useState<MobileRoute>(() => parseMobileRoute(window.location.pathname));
  // Resets on every navigation (including browser back/forward into
  // `/hidden`), not just on mount -- Apple re-asks every time you open
  // Hidden, and #130's password re-ask is a later, stronger version of
  // this same confirm step.
  const [hiddenConfirmed, setHiddenConfirmed] = useState(false);

  useEffect(() => {
    function onPopState() {
      setRoute(parseMobileRoute(window.location.pathname));
      setHiddenConfirmed(false);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(path: string) {
    window.history.pushState(null, "", path);
    setRoute(parseMobileRoute(path));
    setHiddenConfirmed(false);
  }

  function renderContent() {
    if (route.tab === "library") return null;
    if (route.tab === "albums") return <TabPlaceholderScreen title="Albums" />;
    if (route.tab === "search") return <TabPlaceholderScreen title="Search" />;

    // route.tab === "more"
    if (!route.screen) {
      return (
        <MoreScreen
          libraries={me.libraries}
          activeLibraryId={activeLibraryId}
          onActiveLibraryChange={onActiveLibraryChange}
          onNavigate={navigate}
        />
      );
    }
    if (route.screen === "people") {
      return <MorePlaceholderScreen title="People & Pets" onBack={() => navigate("/more")} />;
    }
    if (route.screen === "places") {
      return <MorePlaceholderScreen title="Places" onBack={() => navigate("/more")} />;
    }
    if (route.screen === "media") {
      const title = MEDIA_TYPES.find((type) => type.slug === route.mediaType)?.label ?? route.mediaType;
      return <MorePlaceholderScreen title={title} onBack={() => navigate("/more")} />;
    }
    // route.screen === "hidden"
    if (!hiddenConfirmed) {
      return <HiddenConfirm onConfirm={() => setHiddenConfirmed(true)} onCancel={() => navigate("/more")} />;
    }
    return (
      <div className="mobile-screen">
        <header className="mobile-screen__header">
          <button type="button" className="mobile-screen__back" onClick={() => navigate("/more")}>
            <Icon name="chevron" className="mobile-screen__back-icon" />
            More
          </button>
          <h1 className="mobile-screen__title">Hidden</h1>
        </header>
        <div className="mobile-screen__body">
          {activeLibraryId !== undefined && <HiddenView libraryId={activeLibraryId} />}
        </div>
      </div>
    );
  }

  return (
    <div className="shell shell--mobile">
      <header className="shell__header">
        <h1 className="sr-only">{TABS.find((tab) => tab.key === route.tab)?.label ?? "Library"}</h1>
        <AccountMenu
          me={me}
          layoutOverride={layoutOverride}
          onLayoutOverrideChange={onLayoutOverrideChange}
          onLogout={onLogout}
          compact
        />
      </header>
      <main className="shell__content">
        {/* Stays mounted across tab switches so the grid's segment and scroll
            position survive Library -> More -> Library, like iOS Photos. */}
        <div style={{ height: "100%", display: route.tab === "library" ? "block" : "none" }}>
          {activeLibraryId !== undefined ? (
            <MobileLibrary
              key={activeLibraryId}
              libraryId={activeLibraryId}
              initialAssetId={deepLinkAssetId}
              onInitialAssetOpened={onDeepLinkConsumed}
            />
          ) : (
            <LibraryPlaceholder />
          )}
        </div>
        {route.tab !== "library" && renderContent()}
      </main>
      <nav className="tab-bar" aria-label="Primary">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="tab-bar__item"
            aria-current={route.tab === tab.key ? "page" : undefined}
            onClick={() => navigate(mobileRoutePath({ tab: tab.key } as MobileRoute))}
          >
            <Icon name={tab.icon} className="tab-bar__icon" />
            <span className="tab-bar__label">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
