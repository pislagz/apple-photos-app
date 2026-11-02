import { useEffect, useState } from "react";
import { ApiError, getMe, login, type MeResponse } from "./api";
import AuditLogScreen from "./screens/AuditLogScreen";
import LibrariesScreen from "./screens/LibrariesScreen";
import SessionsScreen from "./screens/SessionsScreen";
import SettingsScreen from "./screens/SettingsScreen";
import UsersScreen from "./screens/UsersScreen";

type Screen = "libraries" | "users" | "sessions" | "audit-log" | "settings";

const SCREENS: { key: Screen; label: string }[] = [
  { key: "libraries", label: "Libraries" },
  { key: "users", label: "Users" },
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

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setCheckedSession(true));
  }, []);

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
      <main>
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
      <main>
        <p role="alert">This account is not an admin.</p>
      </main>
    );
  }

  return (
    <div className="admin-app">
      <nav aria-label="Admin sections">
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
      <main>
        {screen === "libraries" && <LibrariesScreen />}
        {screen === "users" && <UsersScreen />}
        {screen === "sessions" && <SessionsScreen />}
        {screen === "audit-log" && <AuditLogScreen />}
        {screen === "settings" && <SettingsScreen />}
      </main>
    </div>
  );
}
