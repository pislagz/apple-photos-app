import { useEffect, useState } from "react";
import "./admin.css";
import {
  answerPlaceNamesNotice,
  ApiError,
  downloadPlaceNames,
  getMe,
  login,
  type MeResponse,
  type PlaceNamesStatus,
  readPlaceNames,
} from "./api";
import { MAP_PLACE_NAMES_ANCHOR } from "../shell/PlaceInfoContext";
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
  const [screen, setScreen] = useState<Screen>(() =>
    window.location.hash === `#${MAP_PLACE_NAMES_ANCHOR}` ? "settings" : "libraries",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  // Shown until an admin has answered the "Map & place names" question.
  const [optInsReviewed, setOptInsReviewed] = useState(true);
  // After "Allow": the automatic place-name download, shown like the manual one.
  const [noticeProgress, setNoticeProgress] = useState<{ kind: "working" | "done" | "failed" | "error"; text: string } | null>(
    null,
  );
  const [answering, setAnswering] = useState(false);

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
      .then((status: PlaceNamesStatus) => setOptInsReviewed(status.consent_decided))
      .catch(() => setOptInsReviewed(true));
  }, [isAdmin, screen]);

  async function startPlaceNamesDownload() {
    setNoticeProgress({ kind: "working", text: "Downloading place-name data…" });
    try {
      await downloadPlaceNames();
      setNoticeProgress({ kind: "done", text: "Place-name data downloaded." });
    } catch (err) {
      const reason = err instanceof ApiError ? err.message : "something went wrong";
      setNoticeProgress({
        kind: "failed",
        text: `Place-name data could not be downloaded: ${reason}. You can retry it in Settings.`,
      });
    }
  }

  async function answerNotice(agree: boolean) {
    setAnswering(true);
    try {
      await answerPlaceNamesNotice(agree);
      setOptInsReviewed(true);
    } catch (err) {
      setNoticeProgress({
        kind: "error",
        text: err instanceof ApiError ? err.message : "something went wrong",
      });
      return;
    } finally {
      setAnswering(false);
    }
    if (agree) await startPlaceNamesDownload();
  }

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
          <div className="admin-notice" role="note" data-testid="opt-in-notice">
            <p>
              The map and place names are off until you agree to use OpenStreetMap data. Allowing it also downloads a
              public city list (GeoNames) once; nothing about your photos is sent.
            </p>
            <div className="admin-notice__actions">
              <button type="button" onClick={() => answerNotice(true)} disabled={answering}>
                Allow
              </button>
              <button type="button" onClick={() => answerNotice(false)} disabled={answering}>
                Not now
              </button>
              <button type="button" className="admin-link" onClick={() => setScreen("settings")}>
                Review it in Settings
              </button>
            </div>
          </div>
        )}
        {noticeProgress && (
          <p className="admin-notice" role="status" data-testid="place-names-progress" data-state={noticeProgress.kind}>
            {noticeProgress.text}{" "}
            {noticeProgress.kind === "failed" && (
              <button type="button" onClick={startPlaceNamesDownload}>
                Retry
              </button>
            )}
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
