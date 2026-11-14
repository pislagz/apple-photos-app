import { useEffect, useState } from "react";
import type { MeResponse } from "../api";
import { HiddenSession, HiddenUnlock } from "./HiddenUnlock";
import HiddenView from "./HiddenView";
import { Icon, type IconName } from "./icons";
import MobileLibrary from "./library/MobileLibrary";
import LibraryUpdating from "./LibraryUpdating";
import PeopleScreen from "./people/PeopleScreen";
import PlacesScreen from "./map/PlacesScreen";
import AlbumsTab, { AlbumPhotos } from "./albums/AlbumsTab";
import { MEDIA_TYPES } from "./more/mediaTypes";
import MorePlaceholderScreen from "./more/MorePlaceholderScreen";
import MoreScreen from "./more/MoreScreen";
import { type MobileRoute, type MobileTab, mobileRoutePath, parseMobileRoute } from "./route";
import SearchScreen from "./search/SearchScreen";
import TabPlaceholderScreen from "./TabPlaceholderScreen";
import WelcomeScreen from "./WelcomeScreen";
import type { LayoutOverride } from "./useLayout";
import { LibraryNoteFrame } from "./library/LibraryUpdatedNote";

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
  onNoteDismissed,
  onAvatarChanged,
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
  onAvatarChanged?: () => void;
}) {
  const [route, setRoute] = useState<MobileRoute>(() => parseMobileRoute(window.location.pathname));
  // Resets on every navigation (including browser back/forward into
  // `/hidden`), not just on mount -- Apple re-asks every time you open
  // Hidden. #130: the ask is the account password.
  const [hiddenConfirmed, setHiddenConfirmed] = useState(false);
  // #146: re-tapping the active Library tab sends the grid back to the newest photos.
  const [libraryResetSignal, setLibraryResetSignal] = useState(0);

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

  // Typing in Search rewrites the current entry instead of adding one.
  function replaceRoute(path: string) {
    window.history.replaceState(null, "", path);
    setRoute(parseMobileRoute(path));
  }

  const unavailable =
    activeLibraryId === undefined
      ? "Nothing here yet. Photos appear once a library has been added."
      : "Your library is being prepared. This will appear when it's ready.";

  function renderContent() {
    if (route.tab === "library") return null;
    if (route.tab === "albums") {
      if (activeLibraryId === undefined || me.libraries.find((l) => l.id === activeLibraryId)?.updating) {
        return <TabPlaceholderScreen title="Albums" message={unavailable} />;
      }
      return (
        <AlbumsTab
          key={activeLibraryId}
          libraryId={activeLibraryId}
          folderId={route.folderId}
          albumId={route.albumId}
          onNavigate={navigate}
        />
      );
    }
    if (route.tab === "search") {
      if (activeLibraryId === undefined || me.libraries.find((l) => l.id === activeLibraryId)?.updating) {
        return <TabPlaceholderScreen title="Search" message={unavailable} />;
      }
      return (
        <SearchScreen
          key={activeLibraryId}
          libraryId={activeLibraryId}
          query={route.query ?? ""}
          onQueryChange={(query) => replaceRoute(mobileRoutePath({ tab: "search", query }))}
        />
      );
    }

    // route.tab === "more"
    if (!route.screen) {
      return (
        <MoreScreen
          libraries={me.libraries}
          activeLibraryId={activeLibraryId}
          onActiveLibraryChange={onActiveLibraryChange}
          onNavigate={navigate}
          me={me}
          layoutOverride={layoutOverride}
          onLayoutOverrideChange={onLayoutOverrideChange}
          onLogout={onLogout}
          onAvatarChanged={onAvatarChanged}
        />
      );
    }
    if (route.screen === "people") {
      if (activeLibraryId === undefined || me.libraries.find((l) => l.id === activeLibraryId)?.updating) {
        return <MorePlaceholderScreen title="People & Pets" message={unavailable} onBack={() => navigate("/more")} />;
      }
      return (
        <PeopleScreen
          key={activeLibraryId}
          libraryId={activeLibraryId}
          personId={route.personId}
          onNavigate={navigate}
        />
      );
    }
    if (route.screen === "places") {
      if (activeLibraryId === undefined || me.libraries.find((l) => l.id === activeLibraryId)?.updating) {
        return <MorePlaceholderScreen title="Places" message={unavailable} onBack={() => navigate("/more")} />;
      }
      return <PlacesScreen key={activeLibraryId} libraryId={activeLibraryId} bbox={route.bbox} onNavigate={navigate} />;
    }
    if (route.screen === "media") {
      const title = MEDIA_TYPES.find((type) => type.slug === route.mediaType)?.label ?? route.mediaType;
      // Each media type is a smart album with the same slug.
      if (activeLibraryId !== undefined && MEDIA_TYPES.some((t) => t.slug === route.mediaType)) {
        return (
          <AlbumPhotos
            libraryId={activeLibraryId}
            albumId={`smart:${route.mediaType}`}
            title={title}
            backLabel="More"
            onBack={() => navigate("/more")}
          />
        );
      }
      const known = MEDIA_TYPES.some((t) => t.slug === route.mediaType);
      return (
        <MorePlaceholderScreen
          title={title}
          message={known ? unavailable : "This page doesn't exist."}
          onBack={() => navigate("/more")}
        />
      );
    }
    // route.screen === "hidden"
    if (!hiddenConfirmed) {
      return (
        <div className="mobile-screen">
          <header className="mobile-screen__header">
            <button type="button" className="mobile-screen__back" onClick={() => navigate("/more")}>
              <Icon name="chevron" className="mobile-screen__back-icon" />
              More
            </button>
          </header>
          <HiddenUnlock variant="mobile" onUnlocked={() => setHiddenConfirmed(true)} onCancel={() => navigate("/more")} />
        </div>
      );
    }
    return (
      <HiddenSession>
      <div className="mobile-screen">
        <header className="mobile-screen__header">
          <button type="button" className="mobile-screen__back" onClick={() => navigate("/more")}>
            <Icon name="chevron" className="mobile-screen__back-icon" />
            More
          </button>
          <h1 className="mobile-screen__title">Hidden</h1>
        </header>
        <div className="mobile-screen__body">
          {activeLibraryId !== undefined && <HiddenView libraryId={activeLibraryId} variant="mobile" onCancel={() => navigate("/more")} />}
        </div>
      </div>
      </HiddenSession>
    );
  }

  const activeLibrary = me.libraries.find((library) => library.id === activeLibraryId);
  return (
    <div className="shell shell--mobile">
      <header className="shell__header">
        <h1 className="sr-only">{TABS.find((tab) => tab.key === route.tab)?.label ?? "Library"}</h1>
      </header>
      <main className="shell__content">
        {/* Stays mounted across tab switches so the grid's segment and scroll
            position survive Library -> More -> Library, like iOS Photos. */}
        <div style={{ height: "100%", display: route.tab === "library" ? "block" : "none" }}>
          {activeLibrary?.updating ? (
            <LibraryUpdating name={activeLibrary.display_name} reason={activeLibrary.updating_reason} />
          ) : activeLibraryId !== undefined ? (
            <LibraryNoteFrame
              libraryId={activeLibraryId}
              note={activeLibrary?.updated_note}
              variant="mobile"
              onDismissed={onNoteDismissed}
            >
              <MobileLibrary
                key={activeLibraryId}
                libraryId={activeLibraryId}
                resetSignal={libraryResetSignal}
                isAdmin={me.role === "admin"}
                initialAssetId={deepLinkAssetId}
                onInitialAssetOpened={onDeepLinkConsumed}
              />
            </LibraryNoteFrame>
          ) : (
            <WelcomeScreen isAdmin={me.role === "admin"} />
          )}
        </div>
        {route.tab !== "library" && renderContent()}
      </main>
      <nav className={route.tab === "library" ? "tab-bar tab-bar--overlay" : "tab-bar"} aria-label="Primary">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="tab-bar__item"
            aria-current={route.tab === tab.key ? "page" : undefined}
            onClick={() => {
              if (tab.key === "library" && route.tab === "library") setLibraryResetSignal((n) => n + 1);
              navigate(mobileRoutePath({ tab: tab.key } as MobileRoute));
            }}
          >
            <Icon name={tab.icon} className="tab-bar__icon" filled={route.tab === tab.key} />
            <span className="tab-bar__label">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
