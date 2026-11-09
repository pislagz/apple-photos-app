import { useEffect, useState } from "react";
import {
  ApiError,
  type MapTilesMode,
  readSettings,
  readTailnetAllowlist,
  type SettingsResponse,
  writeSettings,
  writeTailnetAllowlist,
} from "../api";

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "something went wrong";
}

export default function SettingsScreen() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [allowlist, setAllowlist] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    readSettings().then(setSettings).catch((err: unknown) => setError(describeError(err)));
    readTailnetAllowlist()
      .then((response) => setAllowlist(response.identities.join("\n")))
      .catch((err: unknown) => setError(describeError(err)));
  }, []);

  function updateField<K extends keyof SettingsResponse>(key: K, value: SettingsResponse[K]) {
    setSettings((prev) => (prev === null ? prev : { ...prev, [key]: value }));
  }

  async function handleSaveSettings(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (settings === null) return;
    try {
      const saved = await writeSettings(settings);
      setSettings(saved);
      setNotice("Settings saved.");
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleSaveAllowlist(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const identities = allowlist
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    try {
      const saved = await writeTailnetAllowlist(identities);
      setAllowlist(saved.identities.join("\n"));
      setNotice("Allow-list saved.");
    } catch (err) {
      setError(describeError(err));
    }
  }

  if (settings === null) {
    return (
      <section>
        <h1>Settings</h1>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section>
      <h1>Settings</h1>
      {error && <p role="alert">{error}</p>}
      {notice && <p>{notice}</p>}

      <form onSubmit={handleSaveSettings}>
        <label>
          Desktop session lifetime (seconds)
          <input
            type="number"
            value={settings.session_lifetime_desktop_seconds}
            onChange={(event) => updateField("session_lifetime_desktop_seconds", Number(event.target.value))}
          />
        </label>
        <label>
          PWA session lifetime (seconds)
          <input
            type="number"
            value={settings.session_lifetime_pwa_seconds}
            onChange={(event) => updateField("session_lifetime_pwa_seconds", Number(event.target.value))}
          />
        </label>
        <label>
          "Remember me" session lifetime (seconds)
          <input
            type="number"
            value={settings.session_lifetime_remember_me_seconds}
            onChange={(event) => updateField("session_lifetime_remember_me_seconds", Number(event.target.value))}
          />
        </label>
        <label>
          Thumbnail size, grid
          <input
            type="number"
            value={settings.thumb_size_grid}
            onChange={(event) => updateField("thumb_size_grid", Number(event.target.value))}
          />
        </label>
        <label>
          Thumbnail size, grid 2x
          <input
            type="number"
            value={settings.thumb_size_grid2x}
            onChange={(event) => updateField("thumb_size_grid2x", Number(event.target.value))}
          />
        </label>
        <label>
          Thumbnail size, preview
          <input
            type="number"
            value={settings.thumb_size_preview}
            onChange={(event) => updateField("thumb_size_preview", Number(event.target.value))}
          />
        </label>
        <label>
          Thumbnail quality
          <input
            type="number"
            value={settings.thumb_quality}
            onChange={(event) => updateField("thumb_quality", Number(event.target.value))}
          />
        </label>
        <label>
          Zip size limit (bytes)
          <input
            type="number"
            value={settings.zip_size_limit_bytes}
            onChange={(event) => updateField("zip_size_limit_bytes", Number(event.target.value))}
          />
        </label>
        <label>
          Map tiles
          <select
            value={settings.map_tiles_mode}
            onChange={(event) => updateField("map_tiles_mode", event.target.value as MapTilesMode)}
          >
            <option value="online">OpenStreetMap (online)</option>
            <option value="local_file">Local file</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label>
          PMTiles path (optional)
          <input
            value={settings.map_tiles_pmtiles_path ?? ""}
            onChange={(event) => updateField("map_tiles_pmtiles_path", event.target.value === "" ? null : event.target.value)}
          />
        </label>
        <label>
          Library check interval (minutes, 0 = off)
          <input
            type="number"
            min={0}
            max={1440}
            value={settings.library_check_interval_minutes}
            onChange={(event) => updateField("library_check_interval_minutes", Number(event.target.value))}
          />
        </label>
        <label>
          Library must be unchanged for (minutes) before it is re-indexed
          <input
            type="number"
            min={0}
            max={1440}
            value={settings.library_stable_minutes}
            onChange={(event) => updateField("library_stable_minutes", Number(event.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.show_library_updated_note}
            onChange={(event) => updateField("show_library_updated_note", event.target.checked)}
          />
          Tell users when their library was updated
        </label>
        <button type="submit">Save settings</button>
      </form>

      <h2>Tailnet allow-list</h2>
      <p>Empty means everyone on the tailnet. A non-empty list that would lock out your own identity is rejected.</p>
      <form onSubmit={handleSaveAllowlist}>
        <label>
          Identities, one per line
          <textarea value={allowlist} onChange={(event) => setAllowlist(event.target.value)} rows={5} />
        </label>
        <button type="submit">Save allow-list</button>
      </form>
    </section>
  );
}
