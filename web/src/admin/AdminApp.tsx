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
import { Icon, type IconName } from "../shell/icons";
import { type Section, useAdminRoute } from "./route";
import { GroupedList, Row } from "./ui/GroupedList";
import ActivityScreen from "./screens/ActivityScreen";
import LibrariesScreen from "./screens/LibrariesScreen";
import DevicesScreen from "./screens/DevicesScreen";
import SettingsScreen from "./screens/SettingsScreen";
import PeopleScreen from "./screens/PeopleScreen";
import SharingScreen from "./screens/SharingScreen";

const SCREENS: { key: Section; label: string; icon: IconName }[] = [
  { key: "libraries", label: "Libraries", icon: "library" },
  { key: "people", label: "People", icon: "people" },
  { key: "sharing", label: "Sharing", icon: "share" },
  { key: "devices", label: "Devices", icon: "screenshot" },
  { key: "activity", label: "Activity", icon: "days" },
  { key: "settings", label: "Settings", icon: "filter" },
];

const PHOTOS_HREF = "/";

function BackToPhotos() {
  return (
    <a className="admin-back" href={PHOTOS_HREF} data-testid="admin-back">
      <Icon name="chevron" size={14} className="admin-back__chevron" />
      Photos
    </a>
  );
}

// Esc leaves Admin unless something else should take it: an open dialog, or a
// field being typed in (Esc there would throw away what was typed).
function shouldLeaveOnEscape(event: KeyboardEvent): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]')) return false;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) {
    return false;
  }
  return true;
}

export default function AdminApp() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);
  const { route, direction, navigate } = useAdminRoute();
  const screen = route.section;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  // Shown until an admin has answered the "Map & place names" question.
  const [optInsReviewed, setOptInsReviewed] = useState(true);
  // After "Allow": the automatic place-name download, shown like the manual one.
  const [noticeProgress, setNoticeProgress] = useState<{
    kind: "working" | "done" | "failed" | "error";
    text: string;
  } | null>(null);
  const [answering, setAnswering] = useState(false);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setCheckedSession(true));
  }, []);

  const isAdmin = me?.role === "admin";

  useEffect(() => {
    if (!checkedSession || me === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!shouldLeaveOnEscape(event)) return;
      event.preventDefault();
      window.location.assign(PHOTOS_HREF);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [checkedSession, me]);

  useEffect(() => {
    if (!isAdmin) return;
    readPlaceNames()
      .then((status: PlaceNamesStatus) =>
        setOptInsReviewed(status.consent_decided),
      )
      .catch(() => setOptInsReviewed(true));
  }, [isAdmin, screen]);

  async function startPlaceNamesDownload() {
    setNoticeProgress({
      kind: "working",
      text: "Downloading place-name data…",
    });
    try {
      await downloadPlaceNames();
      setNoticeProgress({ kind: "done", text: "Place-name data downloaded." });
    } catch (err) {
      const reason =
        err instanceof ApiError ? err.message : "something went wrong";
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
      setLoginError(
        err instanceof ApiError ? err.message : "something went wrong",
      );
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
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
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
        <BackToPhotos />
      </main>
    );
  }

  return (
    <div className="admin-app" data-detail={route.id !== null}>
      <nav className="admin-nav" aria-label="Admin sections">
        <a className="admin-nav__exit" href="/" aria-label="Back to Photos">
          <span aria-hidden="true">‹</span> Photos
        </a>
        <ul>
          {SCREENS.map((entry) => (
            <li key={entry.key}>
              <button
                type="button"
                aria-current={screen === entry.key}
                onClick={() => navigate(entry.key)}
              >
                <Icon
                  name={entry.icon}
                  size={18}
                  filled={screen === entry.key}
                />
                <span>{entry.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main
        className="admin-main"
        data-nav={direction ?? undefined}
        key={`${route.section}/${route.id ?? ""}`}
      >
        {!optInsReviewed && (
          <div data-testid="opt-in-notice" className="admin-notice-group">
            <GroupedList
              heading="Map & place names"
              footer="Allowing it also downloads a public city list (GeoNames) once. Nothing about your photos is sent."
            >
              <Row
                label="The map and place names are off"
                detail="They stay off until you agree to use OpenStreetMap data."
              />
              <Row
                label="Allow"
                onClick={() => !answering && answerNotice(true)}
              />
              <Row
                label="Not now"
                onClick={() => !answering && answerNotice(false)}
              />
              <Row
                label="Review it in Settings"
                onClick={() => navigate("settings")}
              />
            </GroupedList>
          </div>
        )}
        {noticeProgress && (
          <p
            className="admin-notice"
            role="status"
            data-testid="place-names-progress"
            data-state={noticeProgress.kind}
          >
            {noticeProgress.text}{" "}
            {noticeProgress.kind === "failed" && (
              <button
                type="button"
                className="admin-btn"
                onClick={startPlaceNamesDownload}
              >
                Retry
              </button>
            )}
          </p>
        )}
        {screen === "libraries" && (
          <LibrariesScreen
            selected={route.id}
            onSelect={(id) => navigate("libraries", id)}
          />
        )}
        {screen === "people" && (
          <PeopleScreen
            currentUsername={me.username}
            selected={route.id}
            onSelect={(name) => navigate("people", name)}
          />
        )}
        {screen === "sharing" && <SharingScreen />}
        {screen === "devices" && <DevicesScreen />}
        {screen === "activity" && <ActivityScreen />}
        {screen === "settings" && <SettingsScreen />}
      </main>
    </div>
  );
}
