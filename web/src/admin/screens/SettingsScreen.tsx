import { useEffect, useState } from "react";
import { MAP_PLACE_NAMES_ANCHOR, MAP_PLACE_NAMES_TEXT } from "../../shell/PlaceInfoContext";
import {
  ApiError,
  checkLibrariesNow,
  downloadPlaceNames,
  type PlaceNamesStatus,
  readPlaceNames,
  readSettings,
  readTailnetAllowlist,
  type SettingsResponse,
  writeSettings,
  writeTailnetAllowlist,
} from "../api";

// Both library timing fields: 7 days. 0 on the check interval means "Manual only".
const MAX_MINUTES = 10080;
const DEFAULT_CHECK_MINUTES = 15;

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "something went wrong";
}

export default function SettingsScreen() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [allowlist, setAllowlist] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [placeNames, setPlaceNames] = useState<PlaceNamesStatus | null>(null);
  const [downloadingPlaces, setDownloadingPlaces] = useState(false);
  // Text of number fields while typing. An empty field is a draft, never a 0:
  // it blocks the save instead of silently turning e.g. the library checker off.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    readSettings().then(setSettings).catch((err: unknown) => setError(describeError(err)));
    readPlaceNames().then(setPlaceNames).catch(() => setPlaceNames(null));
    readTailnetAllowlist()
      .then((response) => setAllowlist(response.identities.join("\n")))
      .catch((err: unknown) => setError(describeError(err)));
  }, []);

  // Deep link from the Info panel: /admin#map-place-names.
  const loaded = settings !== null;
  useEffect(() => {
    if (loaded && window.location.hash === `#${MAP_PLACE_NAMES_ANCHOR}`) {
      document.getElementById(MAP_PLACE_NAMES_ANCHOR)?.scrollIntoView?.();
    }
  }, [loaded]);

  function updateField<K extends keyof SettingsResponse>(key: K, value: SettingsResponse[K]) {
    setSettings((prev) => (prev === null ? prev : { ...prev, [key]: value }));
  }

  type NumberKey = {
    [K in keyof SettingsResponse]: SettingsResponse[K] extends number ? K : never;
  }[keyof SettingsResponse];

  function numberProps(key: NumberKey) {
    return {
      type: "number" as const,
      value: drafts[key] ?? String(settings?.[key] ?? ""),
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        const text = event.target.value;
        setDrafts((prev) => ({ ...prev, [key]: text }));
        if (text.trim() !== "" && Number.isFinite(Number(text))) updateField(key, Number(text) as SettingsResponse[typeof key]);
      },
    };
  }

  async function handleSaveSettings(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (settings === null) return;
    const blank = Object.keys(drafts).find((key) => drafts[key].trim() === "" || !Number.isFinite(Number(drafts[key])));
    if (blank !== undefined) {
      setError("Enter a number in every numeric field before saving.");
      return;
    }
    try {
      const saved = await writeSettings(settings);
      setSettings(saved);
      setDrafts({});
      setNotice("Settings saved.");
      readPlaceNames().then(setPlaceNames).catch(() => undefined);
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleDownloadPlaceNames() {
    setError(null);
    setNotice(null);
    setDownloadingPlaces(true);
    try {
      setPlaceNames(await downloadPlaceNames());
      setNotice("Place-name data downloaded.");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setDownloadingPlaces(false);
    }
  }

  async function handleCheckNow() {
    setError(null);
    setNotice(null);
    setChecking(true);
    try {
      const { started } = await checkLibrariesNow();
      setNotice(
        started
          ? "Checking all libraries for changes now. A changed library is re-indexed once it has been unchanged for the wait time above."
          : "A check is already running.",
      );
    } catch (err) {
      setError(describeError(err));
    } finally {
      setChecking(false);
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
          <input {...numberProps("session_lifetime_desktop_seconds")} />
        </label>
        <label>
          PWA session lifetime (seconds)
          <input {...numberProps("session_lifetime_pwa_seconds")} />
        </label>
        <label>
          "Remember me" session lifetime (seconds)
          <input {...numberProps("session_lifetime_remember_me_seconds")} />
        </label>
        <label>
          Thumbnail size, grid
          <input {...numberProps("thumb_size_grid")} />
        </label>
        <label>
          Thumbnail size, grid 2x
          <input {...numberProps("thumb_size_grid2x")} />
        </label>
        <label>
          Thumbnail size, preview
          <input {...numberProps("thumb_size_preview")} />
        </label>
        <label>
          Thumbnail quality
          <input {...numberProps("thumb_quality")} />
        </label>
        <label>
          Zip size limit (bytes)
          <input {...numberProps("zip_size_limit_bytes")} />
        </label>
        <fieldset className="admin-privacy-options" id={MAP_PLACE_NAMES_ANCHOR} data-testid="map-place-names">
          <legend>Map &amp; place names</legend>
          <p className="admin-hint">{MAP_PLACE_NAMES_TEXT}</p>
          <label>
            <input
              type="checkbox"
              checked={settings.osm_consent}
              onChange={(event) => updateField("osm_consent", event.target.checked)}
            />
            Allow
          </label>
          <p className="admin-hint">
            Off until you agree. Agreed: the Map view draws OpenStreetMap tiles, which each person's browser fetches from
            tile.openstreetmap.org while a map is open (this server never does), and place names come from a city list you
            download once below. Not agreed: nothing is downloaded, the map is off and so are offline place names.
          </p>
          <label>
            Local map file (PMTiles), used instead of the OpenStreetMap tiles when set
            <input
              value={settings.map_tiles_pmtiles_path ?? ""}
              onChange={(event) => updateField("map_tiles_pmtiles_path", event.target.value === "" ? null : event.target.value)}
            />
          </label>
          <div className="admin-place-names" data-testid="place-names-status">
            <p>
              {placeNames === null
                ? "Place-name data: checking…"
                : placeNames.downloaded
                  ? `Place-name data: downloaded (${Math.max(1, Math.round(placeNames.size_bytes / 1024))} KB).`
                  : "Place-name data: not downloaded."}
            </p>
            <button type="button" onClick={handleDownloadPlaceNames} disabled={downloadingPlaces || !settings.osm_consent}>
              {placeNames?.downloaded ? "Download again" : "Download place-name data"}
            </button>
            <p className="admin-hint">
              {settings.osm_consent
                ? "This is the one time the server contacts the internet: it fetches the public GeoNames list of cities (cities15000, about 2 MB) from download.geonames.org. No photo data is sent."
                : "Agree and save above to enable the download. Nothing is fetched until then."}
            </p>
            <p className="admin-hint" data-testid="geonames-attribution">
              {placeNames?.attribution ?? "Place names from GeoNames (geonames.org), CC BY 4.0."}
            </p>
          </div>
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={settings.library_check_interval_minutes === 0}
            onChange={(event) => {
              setDrafts(({ library_check_interval_minutes: _dropped, ...rest }) => rest);
              updateField("library_check_interval_minutes", event.target.checked ? 0 : DEFAULT_CHECK_MINUTES);
            }}
          />
          Manual only: don't check libraries for changes automatically
        </label>
        {settings.library_check_interval_minutes === 0 ? (
          <p>Libraries are only checked when you press "Check now".</p>
        ) : (
          <label>
            Check libraries for changes every (minutes)
            <input min={1} max={MAX_MINUTES} {...numberProps("library_check_interval_minutes")} />
          </label>
        )}
        <label>
          Library must be unchanged for (minutes) before it is re-indexed
          <input
            min={0}
            max={MAX_MINUTES}
            {...numberProps("library_stable_minutes")}
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
        <button type="button" onClick={handleCheckNow} disabled={checking}>
          Check now
        </button>
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
