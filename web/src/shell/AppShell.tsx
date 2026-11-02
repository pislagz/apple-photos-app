import { useCallback, useEffect, useState } from "react";
import { ApiError, getMe, login as apiLogin, logout as apiLogout, type MeResponse } from "../api";
import AccessRefused from "./AccessRefused";
import DesktopShell from "./DesktopShell";
import LoginScreen, { type LoginError } from "./LoginScreen";
import MobileShell from "./MobileShell";
import { isStandalone, useLayout } from "./useLayout";

type Status = "loading" | "anonymous" | "authenticated";

export default function AppShell() {
  const { layout, override, setOverride } = useLayout();
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [loginError, setLoginError] = useState<LoginError | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      const response = await getMe();
      setMe(response);
      setStatus("authenticated");
    } catch (error) {
      if (error instanceof ApiError && error.status === 403 && error.message === "tailnet identity not allowed") {
        setBlocked(true);
        return;
      }
      setMe(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

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
      if (error.status === 403 && error.message === "tailnet identity not allowed") {
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
    setMe(null);
    setStatus("anonymous");
  }

  if (blocked) {
    return <AccessRefused />;
  }

  if (status === "loading") {
    return null;
  }

  if (status === "anonymous" || me === null) {
    return <LoginScreen layout={layout} error={loginError} onSubmit={handleLogin} />;
  }

  if (layout === "mobile") {
    return (
      <MobileShell me={me} layoutOverride={override} onLayoutOverrideChange={setOverride} onLogout={handleLogout} />
    );
  }

  return (
    <DesktopShell me={me} layoutOverride={override} onLayoutOverrideChange={setOverride} onLogout={handleLogout} />
  );
}
