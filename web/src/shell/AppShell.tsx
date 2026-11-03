import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  getMe,
  getSetupStatus,
  login as apiLogin,
  logout as apiLogout,
  setLayoutOverride as apiSetLayoutOverride,
  setupAdmin as apiSetupAdmin,
  type MeResponse,
} from "../api";
import AccessRefused from "./AccessRefused";
import { useActiveLibrary } from "./activeLibrary";
import DesktopShell from "./DesktopShell";
import LoginScreen, { type LoginError } from "./LoginScreen";
import MobileShell from "./MobileShell";
import { parsePhotoPath } from "./route";
import SetupScreen from "./SetupScreen";
import { isStandalone, type LayoutOverride, useLayout } from "./useLayout";

type Status = "loading" | "needs-setup" | "anonymous" | "authenticated";

export default function AppShell() {
  const { layout, override, setOverride, applyRemoteOverride } = useLayout();
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [loginError, setLoginError] = useState<LoginError | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  // Captured once at mount, so a "Copy Link" URL survives a sign-in
  // round-trip (the login screen renders from this same component) and
  // still opens the photo once `me` resolves.
  const [deepLink, setDeepLink] = useState(() => parsePhotoPath(window.location.pathname));
  const { activeLibraryId, setActiveLibraryId } = useActiveLibrary(me);

  function consumeDeepLink() {
    setDeepLink(null);
    window.history.replaceState(null, "", "/");
  }

  // A link to a library this account isn't assigned to must 404 the same
  // way the asset routes do -- silently drop it rather than ever fetching
  // the asset to find out. One assigned to the account switches the shared
  // active library (#90) so the Viewer opens against the right one.
  useEffect(() => {
    if (!deepLink || !me) return;
    if (!me.libraries.some((library) => library.id === deepLink.libraryId)) {
      consumeDeepLink();
      return;
    }
    if (activeLibraryId !== deepLink.libraryId) setActiveLibraryId(deepLink.libraryId);
  }, [deepLink, me, activeLibraryId, setActiveLibraryId]);

  const refreshMe = useCallback(async () => {
    try {
      const response = await getMe();
      setMe(response);
      setStatus("authenticated");
      // The server is authoritative once it answers -- localStorage was
      // only this render's fast default.
      applyRemoteOverride(response.layout_override ?? "auto");
    } catch (error) {
      if (error instanceof ApiError && error.status === 403 && error.code === "tailnet_identity_not_allowed") {
        setBlocked(true);
        return;
      }
      setMe(null);
      setStatus("anonymous");
    }
  }, [applyRemoteOverride]);

  useEffect(() => {
    (async () => {
      // Checked once up front, before `/api/me`: a fresh install has no
      // admin yet, so "Sign in" would have nothing to sign in to.
      try {
        const { needs_setup } = await getSetupStatus();
        if (needs_setup) {
          setStatus("needs-setup");
          return;
        }
      } catch {
        // Fall through to the normal sign-in flow if the status check
        // itself fails (e.g. blocked by the tailnet allow-list).
      }
      refreshMe();
    })();
  }, [refreshMe]);

  async function handleSetup(username: string, password: string) {
    setSetupError(null);
    try {
      await apiSetupAdmin(username, password);
      await apiLogin(username, password, false, isStandalone() ? "pwa" : "desktop");
      await refreshMe();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Someone else's first-run request won the race; this is now a
        // normal sign-in.
        setStatus("anonymous");
        return;
      }
      setSetupError(error instanceof ApiError ? error.message : "Could not create the admin account. Try again.");
    }
  }

  function handleLayoutOverrideChange(value: LayoutOverride) {
    setOverride(value);
    apiSetLayoutOverride(value === "auto" ? null : value).catch(() => {
      // Best-effort: the local choice still applies this session even if
      // the server write fails (offline tab, expired session, ...).
    });
  }

  async function handleLogin(username: string, password: string) {
    setLoginError(null);
    try {
      await apiLogin(username, password, false, isStandalone() ? "pwa" : "desktop");
      await refreshMe();
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setLoginError({ kind: "generic", message: "Sign in failed. Try again." });
        return;
      }
      if (error.status === 403 && error.code === "tailnet_identity_not_allowed") {
        setBlocked(true);
        return;
      }
      if (error.status === 429) {
        setLoginError({ kind: "lockout", message: error.message });
        return;
      }
      if (error.status === 401) {
        setLoginError({ kind: "invalid", message: error.message });
        return;
      }
      setLoginError({ kind: "generic", message: error.message });
    }
  }

  async function handleLogout() {
    await apiLogout();
    // A shared device's next sign-in (possibly a different user) must never
    // see a cached navigation from before this logout.
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_CACHE" });
    setMe(null);
    setStatus("anonymous");
  }

  if (blocked) {
    return <AccessRefused />;
  }

  if (status === "loading") {
    return null;
  }

  if (status === "needs-setup") {
    return <SetupScreen layout={layout} error={setupError} onSubmit={handleSetup} />;
  }

  if (status === "anonymous" || me === null) {
    return <LoginScreen layout={layout} error={loginError} onSubmit={handleLogin} />;
  }

  const deepLinkAssetId = deepLink && activeLibraryId === deepLink.libraryId ? deepLink.assetId : undefined;

  if (layout === "mobile") {
    return (
      <MobileShell
        me={me}
        activeLibraryId={activeLibraryId}
        onActiveLibraryChange={setActiveLibraryId}
        layoutOverride={override}
        onLayoutOverrideChange={handleLayoutOverrideChange}
        onLogout={handleLogout}
        deepLinkAssetId={deepLinkAssetId}
        onDeepLinkConsumed={consumeDeepLink}
      />
    );
  }

  return (
    <DesktopShell
      me={me}
      activeLibraryId={activeLibraryId}
      onActiveLibraryChange={setActiveLibraryId}
      layoutOverride={override}
      onLayoutOverrideChange={handleLayoutOverrideChange}
      onLogout={handleLogout}
      deepLinkAssetId={deepLinkAssetId}
      onDeepLinkConsumed={consumeDeepLink}
    />
  );
}
