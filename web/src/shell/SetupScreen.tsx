import { useState } from "react";
import type { SetupChoices } from "../api";
import type { Layout } from "./useLayout";

export default function SetupScreen({
  layout,
  error,
  onSubmit,
}: {
  layout: Layout;
  error: string | null;
  onSubmit: (username: string, password: string, choices: SetupChoices) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showOsmMap, setShowOsmMap] = useState(false);
  const [offlinePlaceNames, setOfflinePlaceNames] = useState(false);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onSubmit(username, password, { show_osm_map: showOsmMap, offline_place_names: offlinePlaceNames });
  }

  return (
    <main className={layout === "mobile" ? "login-screen login-screen--mobile" : "login-screen login-screen--desktop"}>
      <div className="login-card">
        <h1>Create admin account</h1>
        <p>No account exists yet. The first account created here becomes the admin.</p>
        {error && <p role="alert">{error}</p>}
        <form onSubmit={handleSubmit}>
          <label>
            Username
            <input
              value={username}
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <fieldset className="login-options">
            <legend>Optional features (both off; change them any time in Admin → Settings)</legend>
            <label>
              <input type="checkbox" checked={showOsmMap} onChange={(event) => setShowOsmMap(event.target.checked)} />
              Show OpenStreetMap map
            </label>
            <p className="login-hint">
              Each person's browser fetches map tiles from tile.openstreetmap.org while a map is open. The server never does.
            </p>
            <label>
              <input
                type="checkbox"
                checked={offlinePlaceNames}
                onChange={(event) => setOfflinePlaceNames(event.target.checked)}
              />
              Offline place names
            </label>
            <p className="login-hint">
              Names GPS photos after the nearest city, on this server, from a city list you download once in Settings. Photo
              locations never leave the server.
            </p>
          </fieldset>
          <button type="submit">Create admin account</button>
        </form>
      </div>
    </main>
  );
}
