// Turns an audit-log row into one plain sentence. Every action code the server
// writes is listed here; a code that is not (a newer server, an old row) shows
// as neutral text instead of breaking the list.
import type { AuditLogEntry } from "../api";

export type ActivityKind = "sign-in" | "people" | "library" | "settings" | "photos" | "other";

interface Parts {
  who: string;
  person: string | null;
  library: string | null;
  detail: string | null;
}

type Describe = (p: Parts) => string;

const lib = (p: Parts) => (p.library ? `the library ${p.library}` : "a library");
const her = (p: Parts) => p.person ?? "someone";
const kv = (detail: string | null, key: string): string | null => {
  const m = detail?.match(new RegExp(`(?:^|\\s)${key}=(\\S+)`));
  return m ? m[1] : null;
};

const MAP: Record<string, { kind: ActivityKind; say: Describe }> = {
  accept_invite: { kind: "people", say: (p) => `${p.who} joined using an invitation` },
  create_invite: { kind: "people", say: (p) => `${p.who} made an invitation link` },
  cancel_invite: { kind: "people", say: (p) => `${p.who} cancelled an invitation link` },
  create_user: { kind: "people", say: (p) => `${p.who} added ${her(p)}` },
  update_user: { kind: "people", say: (p) => `${p.who} changed the details of ${her(p)}` },
  delete_user: { kind: "people", say: (p) => `${p.who} removed ${kv(p.detail, "username") ?? her(p)}` },
  unlock_user: { kind: "sign-in", say: (p) => `${p.who} unlocked ${her(p)}'s account` },
  change_password: { kind: "sign-in", say: (p) => `${p.who} changed their password` },
  passkey_add: { kind: "sign-in", say: (p) => `${p.who} added a passkey` },
  passkey_remove: { kind: "sign-in", say: (p) => `${p.who} removed a passkey` },
  revoke_session: { kind: "sign-in", say: (p) => `${p.who} signed ${her(p)} out of a device` },
  assign_library: { kind: "people", say: (p) => `${p.who} shared ${lib(p)} with ${her(p)}` },
  unassign_library: { kind: "people", say: (p) => `${p.who} stopped sharing ${lib(p)} with ${her(p)}` },
  add_library: { kind: "library", say: (p) => `${p.who} added ${lib(p)}` },
  rename_library: { kind: "library", say: (p) => `${p.who} renamed ${lib(p)}` },
  remove_library: { kind: "library", say: (p) => `${p.who} removed ${lib(p)}` },
  reindex_library: { kind: "library", say: (p) => `${p.who} refreshed ${lib(p)}` },
  "library.check_now": { kind: "library", say: (p) => `${p.who} checked the libraries for changes` },
  "library.file_missing": { kind: "library", say: (p) => `${p.library ?? "A library"} could not be found` },
  "library.update.applied": { kind: "library", say: (p) => `${p.library ?? "A library"} was updated with new photos` },
  "library.update.failed": { kind: "library", say: (p) => `${p.library ?? "A library"} could not be updated` },
  "library.replace.previewed": { kind: "library", say: (p) => `${p.who} previewed replacing ${lib(p)}` },
  "library.replace.confirmed": { kind: "library", say: (p) => `${p.who} replaced ${lib(p)}` },
  "prewarm.start": { kind: "library", say: (p) => `${p.who} started preparing thumbnails for ${lib(p)}` },
  "prewarm.pause": { kind: "library", say: (p) => `${p.who} paused preparing thumbnails for ${lib(p)}` },
  "prewarm.auto_restart": { kind: "library", say: (p) => `Thumbnails for ${lib(p)} started preparing again` },
  "prewarm.clear_cache": { kind: "library", say: (p) => `${p.who} deleted the prepared thumbnails for ${lib(p)}` },
  set_settings: { kind: "settings", say: (p) => `${p.who} changed settings` },
  set_tailnet_allowlist: { kind: "settings", say: (p) => `${p.who} changed who can open the app` },
  osm_consent_agreed: { kind: "settings", say: (p) => `${p.who} turned on map and place names` },
  osm_consent_withdrawn: { kind: "settings", say: (p) => `${p.who} turned off map and place names` },
  osm_consent_not_now: { kind: "settings", say: (p) => `${p.who} chose not to turn on map and place names yet` },
  place_names_download: { kind: "settings", say: (p) => `${p.who} downloaded the list of place names` },
  download: { kind: "photos", say: (p) => `${her(p)} downloaded a photo${p.library ? ` from ${p.library}` : ""}` },
  zip: { kind: "photos", say: (p) => `${her(p)} downloaded several photos${p.library ? ` from ${p.library}` : ""}` },
};

/** Codes the server writes that this file can word. Exported for the tests. */
export const KNOWN_ACTIONS = Object.keys(MAP);

export function isKnownAction(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(MAP, action);
}

function nameOfActor(actor: string | null): string {
  if (actor === null || actor === "") return "Someone";
  if (actor === "cli") return "An administrator at the server";
  if (actor === "system" || actor === "auto") return "The app";
  return actor;
}

export interface ActivityLine {
  sentence: string;
  kind: ActivityKind;
  known: boolean;
}

export function describeActivity(entry: AuditLogEntry): ActivityLine {
  const parts: Parts = {
    who: nameOfActor(entry.actor),
    person: entry.username,
    library: entry.library_display_name,
    detail: entry.detail,
  };
  if (isKnownAction(entry.action)) {
    const { kind, say } = MAP[entry.action];
    return { sentence: say(parts), kind, known: true };
  }
  // Unknown code: say it neutrally rather than guess. Underscores and dots read as spaces.
  const raw = String(entry.action ?? "").replace(/[_.]+/g, " ").trim();
  const text = raw === "" ? "Something happened" : `${parts.who}: ${raw}`;
  return { sentence: text, kind: "other", known: false };
}
