import { useEffect, useState } from "react";
import "./admin.css";
import { ApiError, getMe, login, type MeResponse, type PlaceNamesStatus, readPlaceNames } from "./api";
import AccessScreen from "./screens/AccessScreen";
import AuditLogScreen from "./screens/AuditLogScreen";
import LibrariesScreen from "./screens/LibrariesScreen";
import SessionsScreen from "./screens/SessionsScreen";
import SettingsScreen from "./screens/SettingsScreen";
import UsersScreen from "./screens/UsersScreen";

type Screen = "libraries" | "users" | "access" | "sessions" | "audit-log" | "settings";

const SCREENS: { key: Screen; label: string }[] = [
  { key: "libraries", label: "Libraries" },
  { key: "users", label: "Users" },
  { key: "access", label: "Access" },
  { key: "sessions", label: "Sessions" },
  { key: "audit-log", label: "Audit log" },
  { key: "settings", label: "Settings" },
];

export default function AdminApp() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);
  const [screen, setScreen] = useState<Screen>("libraries");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  // D41: shown until an admin has saved Settings (or chosen at first run).
  const [optInsReviewed, setOptInsReviewed] = useState(true);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setCheckedSession(true));
  }, []);

  const isAdmin = me?.role === "admin";
  useEffect(() => {
    if (!isAdmin) return;
    readPlaceNames()
      .then((status: PlaceNamesStatus) => setOptInsReviewed(status.opt_ins_reviewed))
      .catch(() => setOptInsReviewed(true));
  }, [isAdmin, screen]);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoginError(null);
    try {
      await login(username, password);
      setMe(await getMe());
    } catch (err) {
      setLoginError(err instanceof ApiError ? err.message : "something went wrong");
    }
  }

  if (!checkedSession) {
    return null;
  }

  if (me === null) {
    return (
      <main className="admin-auth">
        <h1>Sign in</h1>
        {loginError && <p role="alert">{loginError}</p>}
        <form onSubmit={handleLogin}>
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button type="submit">Sign in</button>
        </form>
      </main>
    );
  }

  if (me.role !== "admin") {
    return (
      <main className="admin-auth">
        <p role="alert">This account is not an admin.</p>
      </main>
    );
  }

  return (
    <div className="admin-app">
      <nav className="admin-nav" aria-label="Admin sections">
        <ul>
          {SCREENS.map((entry) => (
            <li key={entry.key}>
              <button
                type="button"
                aria-current={screen === entry.key}
                onClick={() => setScreen(entry.key)}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="admin-main">
        {!optInsReviewed && (
          <p className="admin-notice" role="note" data-testid="opt-in-notice">
            Two optional features are off: the OpenStreetMap map and offline place names.{" "}
            <button type="button" className="admin-link" onClick={() => setScreen("settings")}>
              Review them in Settings
            </button>
          </p>
        )}
        {screen === "libraries" && <LibrariesScreen />}
        {screen === "users" && <UsersScreen />}
        {screen === "access" && <AccessScreen />}
        {screen === "sessions" && <SessionsScreen />}
        {screen === "audit-log" && <AuditLogScreen />}
        {screen === "settings" && <SettingsScreen />}
      </main>
    </div>
  );
}
