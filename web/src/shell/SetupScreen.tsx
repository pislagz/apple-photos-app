import { useState } from "react";
import type { SetupChoices } from "../api";
import { MAP_PLACE_NAMES_TEXT } from "./PlaceInfoContext";
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
  const [allowOsm, setAllowOsm] = useState(false);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onSubmit(username, password, { osm_consent: allowOsm });
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
          <fieldset className="login-options" data-testid="setup-map-place-names">
            <legend>Map &amp; place names</legend>
            <p className="login-hint">{MAP_PLACE_NAMES_TEXT}</p>
            <label>
              <input type="checkbox" checked={allowOsm} onChange={(event) => setAllowOsm(event.target.checked)} />
              Allow
            </label>
            <p className="login-hint">Off until you agree. You can change this any time in Admin → Settings.</p>
          </fieldset>
          <button type="submit">Create admin account</button>
        </form>
      </div>
    </main>
  );
}
