import { useEffect, useState } from "react";
import InfoButton from "../../help/InfoButton";
import type { HelpKey } from "../../help/adminHelp";
import { MAP_PLACE_NAMES_ANCHOR, MAP_PLACE_NAMES_TEXT } from "../../shell/PlaceInfoContext";
import {
  ApiError,
  checkLibrariesNow,
  downloadPlaceNames,
  type PlaceNamesStatus,
  patchSettings,
  readPlaceNames,
  readSettings,
  readTailnetAllowlist,
  type SettingsResponse,
  writeTailnetAllowlist,
} from "../api";
import { Footer, GroupedList, Row } from "../ui/GroupedList";
import SavedStatus, { useSaveStatus } from "../ui/SavedStatus";
import Switch from "../ui/Switch";
import { formatBytes } from "../ui/format";
import {
  CACHE_SIZE,
  CHECK_INTERVAL,
  type Choice,
  DESKTOP_SESSION,
  exactNote,
  matchesPicture,
  nearestChoice,
  nearestPicture,
  PICTURE_QUALITY,
  PWA_SESSION,
  REMEMBER_SESSION,
  STABLE_WAIT,
  ZIP_LIMIT,
} from "./settingsChoices";

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "something went wrong";
}

type Save = (changes: Partial<SettingsResponse>) => Promise<unknown>;

// One row = label, control, inline save status, (i). The row saves by itself.
function SettingRow({
  label,
  help,
  name,
  extra,
  children,
}: {
  label: string;
  help: HelpKey;
  name: string;
  extra?: string;
  children: (run: (save: () => Promise<unknown>) => Promise<boolean>) => React.ReactNode;
}) {
  const { state, error, run } = useSaveStatus();
  return (
    <Row
      label={label}
      info={<InfoButton helpKey={help} name={name} extra={extra} />}
      control={
        <>
          {children(run)}
          <SavedStatus state={state} message={error} />
        </>
      }
    />
  );
}

// A menu of ready choices. A stored value that is not one of them shows as the nearest
// choice; the exact value goes into the (i) and is left alone until a choice is picked.
function ChoiceRow({
  label,
  help,
  name,
  choices,
  field,
  kind,
  settings,
  save,
}: {
  label: string;
  help: HelpKey;
  name: string;
  choices: Choice[];
  field: Exclude<keyof SettingsResponse, "map_tiles_mode" | "map_tiles_pmtiles_path" | "osm_consent" | "show_library_updated_note" | "keep_signed_in_mode">;
  kind: "seconds" | "bytes" | "minutes";
  settings: SettingsResponse;
  save: Save;
}) {
  const stored = settings[field];
  const exact = choices.some((c) => c.value === stored);
  const shown = nearestChoice(choices, stored);
  return (
    <SettingRow label={label} help={help} name={name} extra={exact ? undefined : exactNote(kind, stored)}>
      {(run) => (
        <select
          className="admin-input"
          aria-label={label}
          value={shown.value}
          onChange={(event) => {
            const value = Number(event.target.value);
            void run(() => save({ [field]: value }));
          }}
        >
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      )}
    </SettingRow>
  );
}

// #289: whether the sign-in screen offers "Keep me signed in", and its starting state.
const KEEP_SIGNED_IN_CHOICES: { value: SettingsResponse["keep_signed_in_mode"]; label: string }[] = [
  { value: "default_on", label: "Offered, ticked by default" },
  { value: "default_off", label: "Offered, unticked by default" },
  { value: "disabled", label: "Not offered (sign-in ends when the browser closes)" },
];

function KeepSignedInRow({ settings, save }: { settings: SettingsResponse; save: Save }) {
  return (
    <SettingRow label="Keep me signed in box" help="keepSignedInMode" name="keep me signed in on the sign-in screen">
      {(run) => (
        <select
          className="admin-input"
          aria-label="Keep me signed in box"
          value={settings.keep_signed_in_mode}
          onChange={(event) => {
            const value = event.target.value as SettingsResponse["keep_signed_in_mode"];
            void run(() => save({ keep_signed_in_mode: value }));
          }}
        >
          {KEEP_SIGNED_IN_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      )}
    </SettingRow>
  );
}

function PictureQualityRow({ settings, save }: { settings: SettingsResponse; save: Save }) {
  const exact = PICTURE_QUALITY.find((p) => matchesPicture(p, settings as unknown as Record<string, number>));
  const shown = exact ?? nearestPicture(settings);
  const note = exact
    ? undefined
    : `It is currently set to a custom mix (grid ${settings.thumb_size_grid}, sharp screens ${settings.thumb_size_grid2x}, preview ${settings.thumb_size_preview} pixels wide, quality ${settings.thumb_quality} of 100), which is not one of the choices; it stays as it is until you pick a choice.`;
  return (
    <SettingRow label="Picture quality" help="pictureQuality" name="picture quality" extra={note}>
      {(run) => (
        <select
          className="admin-input"
          aria-label="Picture quality"
          value={shown.label}
          onChange={(event) => {
            const pick = PICTURE_QUALITY.find((p) => p.label === event.target.value)!;
            const { label: _label, ...fields } = pick;
            void run(() => save(fields));
          }}
        >
          {PICTURE_QUALITY.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>
      )}
    </SettingRow>
  );
}

function SwitchRow({
  label,
  help,
  name,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help: HelpKey;
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => Promise<unknown>;
}) {
  return (
    <SettingRow label={label} help={help} name={name}>
      {(run) => <Switch checked={checked} label={label} disabled={disabled} onChange={(next) => void run(() => onChange(next))} />}
    </SettingRow>
  );
}

function TextRow({
  label,
  help,
  name,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  help: HelpKey;
  name: string;
  value: string;
  placeholder?: string;
  onSave: (next: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <SettingRow label={label} help={help} name={name}>
      {(run) => (
        <input
          className="admin-input"
          aria-label={label}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft.trim() !== value) void run(() => onSave(draft.trim()));
          }}
        />
      )}
    </SettingRow>
  );
}

function AllowlistRow({ identities, onSaved }: { identities: string; onSaved: (text: string) => void }) {
  const [draft, setDraft] = useState(identities);
  useEffect(() => setDraft(identities), [identities]);
  const lines = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  const { state, error, run } = useSaveStatus();
  return (
    <div role="listitem" className="admin-row admin-row--stacked">
      <span className="admin-row__text">
        <span className="admin-row__heading">
          <label className="admin-row__label" htmlFor="allowlist-text">
            Who can open the app
          </label>
          <InfoButton helpKey="allowlist" name="who can open the app" />
        </span>
        <span className="admin-row__detail">One name per line. Leave empty to let everyone on your private network in.</span>
        <textarea
          id="allowlist-text"
          className="admin-input admin-input--area"
          rows={4}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const next = lines(draft);
            if (next.join("\n") === lines(identities).join("\n")) return;
            void run(async () => {
              const saved = await writeTailnetAllowlist(next);
              onSaved(saved.identities.join("\n"));
            });
          }}
        />
      </span>
      <span className="admin-row__control">
        <SavedStatus state={state} message={error} />
      </span>
    </div>
  );
}

export default function SettingsScreen() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [allowlist, setAllowlist] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [placeNames, setPlaceNames] = useState<PlaceNamesStatus | null>(null);
  const [downloadingPlaces, setDownloadingPlaces] = useState(false);

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

  // Sends only the changed fields. A failure throws to the row's own status and the
  // control falls back to the stored value, because the value is read from `settings`.
  const save: Save = async (changes) => {
    const saved = await patchSettings(changes);
    setSettings(saved);
    if ("osm_consent" in changes) readPlaceNames().then(setPlaceNames).catch(() => undefined);
  };

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
      setNotice(started ? "Checking all libraries for changes now." : "A check is already running.");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setChecking(false);
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

  const choice = { settings, save };
  return (
    <section className="admin-settings">
      <h1>Settings</h1>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <GroupedList
        heading="Signing in"
        footer="How long people stay signed in before they have to enter their password again. Shorter is safer on shared computers. Changes apply to new sign-ins."
      >
        <ChoiceRow label="On computers" help="sessionDesktop" name="sign-in time on computers" choices={DESKTOP_SESSION} field="session_lifetime_desktop_seconds" kind="seconds" {...choice} />
        <ChoiceRow label="On the Home Screen app" help="sessionPwa" name="sign-in time on the Home Screen app" choices={PWA_SESSION} field="session_lifetime_pwa_seconds" kind="seconds" {...choice} />
        <ChoiceRow label={"When “Keep me signed in” is ticked"} help="sessionRememberMe" name="sign-in time with Keep me signed in" choices={REMEMBER_SESSION} field="session_lifetime_remember_me_seconds" kind="seconds" {...choice} />
        <KeepSignedInRow {...choice} />
      </GroupedList>

      <GroupedList heading="Downloads" footer="Limits on what people can download.">
        <ChoiceRow label="Largest download at once" help="zipLimit" name="largest download" choices={ZIP_LIMIT} field="zip_size_limit_bytes" kind="bytes" {...choice} />
      </GroupedList>

      <GroupedList
        heading="Pictures"
        footer="Pictures are the small previews you scroll through. Better quality looks sharper but takes more space and loads more slowly. When the space is full, the oldest are removed first."
      >
        <PictureQualityRow settings={settings} save={save} />
        <ChoiceRow label="Space for pictures" help="cacheSize" name="space for pictures" choices={CACHE_SIZE} field="media_cache_size_limit_bytes" kind="bytes" {...choice} />
      </GroupedList>

      <GroupedList heading="Libraries" footer={`The app checks your libraries for changes, for example when you copy new photos into one. A library that is still changing waits for the wait time above.`}>
        <ChoiceRow label="Check for changes" help="checkInterval" name="how often to check" choices={CHECK_INTERVAL} field="library_check_interval_minutes" kind="minutes" {...choice} />
        <ChoiceRow label="Wait until a library stops changing" help="stableMinutes" name="wait time" choices={STABLE_WAIT} field="library_stable_minutes" kind="minutes" {...choice} />
        <SwitchRow
          label="Tell people when a library was updated"
          help="updatedNote"
          name="library updated message"
          checked={settings.show_library_updated_note}
          onChange={(next) => save({ show_library_updated_note: next })}
        />
        <Row
          label="Check all libraries now"
          control={
            <>
              <button type="button" className="admin-btn" onClick={handleCheckNow} disabled={checking}>
                Check Now
              </button>
              <InfoButton helpKey="checkNow" name="Check now" />
            </>
          }
        />
      </GroupedList>

      <div id={MAP_PLACE_NAMES_ANCHOR} data-testid="map-place-names">
        <GroupedList
          heading="Map and place names"
          footer={
            <>
              {MAP_PLACE_NAMES_TEXT} Off until you agree.
            </>
          }
        >
          <SwitchRow
            label="Show maps and place names"
            help="mapConsent"
            name="map and place names"
            checked={settings.osm_consent}
            onChange={(next) => save({ osm_consent: next })}
          />
          <div role="listitem" data-testid="place-names-status" className="admin-row">
            <span className="admin-row__text">
              <span className="admin-row__label">Place-name data</span>
              <span className="admin-row__detail">
                {placeNames === null
                  ? "Checking…"
                  : placeNames.downloaded
                    ? placeNames.size_bytes >= 1000 ? `Downloaded (${formatBytes(placeNames.size_bytes)})` : "Downloaded"
                    : "Not downloaded"}
                {!settings.osm_consent && " · Turn on maps and place names above first."}
              </span>
            </span>
            <span className="admin-row__control">
              <button type="button" className="admin-btn" onClick={handleDownloadPlaceNames} disabled={downloadingPlaces || !settings.osm_consent}>
                {placeNames?.downloaded ? "Download Again" : "Download"}
              </button>
              <InfoButton helpKey="placeNamesDownload" name="place-name data download" />
            </span>
          </div>
        </GroupedList>
        <Footer>
          <span data-testid="geonames-attribution">{placeNames?.attribution ?? "Place names from GeoNames (geonames.org), CC BY 4.0."}</span>
        </Footer>
      </div>

      <details className="admin-advanced">
        <summary>Advanced</summary>
        <GroupedList footer="Most people never need to change these.">
          <AllowlistRow identities={allowlist} onSaved={setAllowlist} />
          <TextRow
            label="Offline map file"
            help="mapFile"
            name="offline map file"
            value={settings.map_tiles_pmtiles_path ?? ""}
            placeholder="Path on this server"
            onSave={(next) => save({ map_tiles_pmtiles_path: next === "" ? null : next })}
          />
        </GroupedList>
      </details>
    </section>
  );
}
