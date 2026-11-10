// Thin fetch wrapper shared by the main shell and the admin panel. No
// client library, no CDN -- just `fetch` against same-origin paths,
// matching the server's CSRF check (`session_auth._reject_cross_site_requests`):
// every mutating call gets a JSON Content-Type, even with no body.

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, detail: string, code?: string) {
    super(detail);
    this.status = status;
    this.code = code;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include" });
  if (!response.ok) {
    let detail = response.statusText;
    let code: string | undefined;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") {
        detail = body.detail;
      } else if (typeof body?.detail?.message === "string") {
        // Structured `{code, message}` detail (e.g. the tailnet allow-list
        // 403) -- `code` is the stable machine-readable part; `message` is
        // the human-readable text the plain-string case also carries.
        detail = body.detail.message;
        if (typeof body.detail.code === "string") code = body.detail.code;
      }
    } catch {
      // no JSON body; fall back to statusText
    }
    throw new ApiError(response.status, detail, code);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function mutate<T>(method: string, path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export type Role = "admin" | "user";

export interface LibrarySummary {
  id: number;
  display_name: string;
  // P1.22: the package is missing, still copying, or not valid yet.
  updating?: boolean;
  updating_reason?: string | null;
  // The latest update that changed visible photos, until this user dismisses
  // it. Counts never include Hidden photos.
  updated_note?: UpdatedNote | null;
}

export interface UpdatedNote {
  run_id: number;
  added: number;
  removed: number;
  finished_at: string | null;
}

export function dismissUpdatedNote(libraryId: number, runId: number): Promise<{ run_id: number }> {
  return mutate<{ run_id: number }>("POST", `/api/libraries/${libraryId}/updated-note/dismiss`, { run_id: runId });
}

export interface MeResponse {
  username: string;
  role: Role;
  libraries: LibrarySummary[];
  layout_override: "desktop" | "mobile" | null;
}

export interface AuthUserResponse {
  username: string;
  role: Role;
}

export function getMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/me");
}

export interface SetupStatusResponse {
  needs_setup: boolean;
}

// Lets the shell show "Create admin account" instead of "Sign in" before
// any user row exists. `POST /api/setup/admin` 409s once it has run once,
// so this is only ever a display choice, not a security boundary.
export function getSetupStatus(): Promise<SetupStatusResponse> {
  return request<SetupStatusResponse>("/api/setup/status");
}

export function setupAdmin(username: string, password: string): Promise<AuthUserResponse> {
  return mutate<AuthUserResponse>("POST", "/api/setup/admin", { username, password });
}

// `client` picks the session lifetime (`session_auth.py`): longer for the
// installed PWA, shorter for desktop by default. The shell passes the
// detected layout; the admin panel always signs in as "desktop".
export function login(
  username: string,
  password: string,
  rememberMe = false,
  client: "desktop" | "pwa" = "desktop",
): Promise<AuthUserResponse> {
  return mutate<AuthUserResponse>("POST", "/api/auth/login", {
    username,
    password,
    remember_me: rememberMe,
    client,
  });
}

// #130: re-ask for the signed-in user's own password before Hidden opens.
// 401 wrong password, 429 locked out. Does not touch the session cookie.
export function reconfirmPassword(password: string): Promise<void> {
  return mutate<void>("POST", "/api/auth/reconfirm-password", { password });
}

// #71: change the signed-in user's own password. 401 wrong current password,
// 429 locked out, 422 new password too short. Other sessions are revoked; this
// one stays signed in.
export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return mutate<void>("POST", "/api/auth/change-password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

// Re-lock Hidden server-side when the user leaves it.
export function lockHidden(): Promise<void> {
  return mutate<void>("POST", "/api/auth/lock-hidden");
}

export function logout(): Promise<void> {
  return mutate<void>("POST", "/api/auth/logout");
}

// The server is the source of truth for this choice; localStorage
// (`useLayout.ts`) is only a fast default while `/api/me` loads.
export function setLayoutOverride(value: "desktop" | "mobile" | null): Promise<void> {
  return mutate<void>("PUT", "/api/me/layout-override", { layout_override: value });
}

export interface AssetListItem {
  id: string;
  filename: string | null;
  date: string | null;
  is_video: boolean;
  is_live_photo: boolean;
  favorite: boolean;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface AssetListResponse {
  items: AssetListItem[];
  next_cursor: string | null;
}

// Apple Photos' Hidden album (P1.13): the only list a hidden asset appears
// in. Every other route excludes it.
export function getHidden(libraryId: number, cursor: string | null = null, limit?: number): Promise<AssetListResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const query = params.toString();
  return request<AssetListResponse>(`/api/libraries/${libraryId}/hidden${query ? `?${query}` : ""}`);
}

// P1.14 mobile Library: the Years/Months/Days/All Photos feed. Never
// `/hidden` -- a hidden asset must not reach any of those views. `to`
// anchors the first page at a given local day (#91's Month -> Days
// drill-down), so landing on a month deep in the library pages back from
// that month instead of from the top of the whole library.
// `filter` (#132, desktop Filter By) maps onto the server's `type` and
// `favorite` query params; "all" sends neither.
export type AssetFilter = "all" | "favorites" | "photos" | "videos";

export const PERSON_PREFIX = "person:";
// P2.3: `place:<west,south,east,north>` selects the photos inside a map
// bounding box (`?place=`), so a cluster opens in the ordinary grid.
export const PLACE_PREFIX = "place:";
// P2.4: `search:<query>` lists search results (`GET /search?q=`).
export const SEARCH_PREFIX = "search:";

export function getAssets(
  libraryId: number,
  cursor: string | null,
  limit = 200,
  to: string | null = null,
  filter: AssetFilter = "all",
  album: string | null = null,
): Promise<AssetListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (album?.startsWith(SEARCH_PREFIX)) {
    params.set("q", album.slice(SEARCH_PREFIX.length));
    if (cursor) params.set("cursor", cursor);
    return request<AssetListResponse>(`/api/libraries/${libraryId}/search?${params.toString()}`);
  }
  // P2.2: `person:<uuid>` selects a person's photos (`?person=`); anything
  // else is an album id, as in P2.1.
  if (album?.startsWith(PERSON_PREFIX)) params.set("person", album.slice(PERSON_PREFIX.length));
  else if (album?.startsWith(PLACE_PREFIX)) params.set("place", album.slice(PLACE_PREFIX.length));
  else if (album) params.set("album", album);
  if (cursor) params.set("cursor", cursor);
  if (to) params.set("to", to);
  if (filter === "favorites") params.set("favorite", "true");
  else if (filter === "photos") params.set("type", "photo");
  else if (filter === "videos") params.set("type", "video");
  return request<AssetListResponse>(`/api/libraries/${libraryId}/assets?${params.toString()}`);
}

// P2.1: `tree` is the folder tree (folders nest, albums are leaves);
// `smart` is the built-in albums with at least one visible asset. An album's
// photos are listed with `getAssets(..., album)`: an album's `id`, or
// `smart:<slug>` for a smart album (the server's `id` already has that form).
export interface AlbumNode {
  id: string;
  kind: "album" | "folder";
  title: string;
  count: number | null;
  cover_id: string | null;
  children: AlbumNode[];
}

export interface SmartAlbum {
  id: string;
  title: string;
  count: number;
  cover_id: string | null;
}

export interface AlbumsResponse {
  tree: AlbumNode[];
  smart: SmartAlbum[];
}

export function getAlbums(libraryId: number): Promise<AlbumsResponse> {
  return request<AlbumsResponse>(`/api/libraries/${libraryId}/albums`);
}

// P2.2/D25: people with at least one visible photo: named ones first, then
// unnamed face groups (`name` null), each most photos first.
// `cover` is the person's best face on a visible photo: the circular crop is
// the ordinary `/thumb/{asset_id}` clipped client-side (x/y centre, w/h size,
// fractions of the displayed image, top-left origin).
export interface FaceCrop {
  asset_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Person {
  id: string;
  name: string | null;
  count: number;
  cover: FaceCrop | null;
}

export function getPeople(libraryId: number): Promise<{ people: Person[] }> {
  return request<{ people: Person[] }>(`/api/libraries/${libraryId}/people`);
}

export interface SummaryBucket {
  key: string;
  count: number;
}

export interface SummaryPeriodBucket extends SummaryBucket {
  key_asset_ids: string[];
}

export interface SummaryResponse {
  years: SummaryPeriodBucket[];
  months: SummaryPeriodBucket[];
  days: SummaryBucket[];
}

// #91: the mobile Years/Months tiles -- counts and a few key-photo
// candidates per period, computed server-side over the whole library, so
// neither view needs to page through `/assets` to render.
export function getSummary(libraryId: number): Promise<SummaryResponse> {
  return request<SummaryResponse>(`/api/libraries/${libraryId}/summary`);
}

export interface AssetDetailResponse {
  id: string;
  filename: string | null;
  original_filename: string | null;
  title: string | null;
  description: string | null;
  date_created: string | null;
  date_added: string | null;
  date_modified: string | null;
  favorite: boolean;
  hidden: boolean;
  is_video: boolean;
  is_live_photo: boolean;
  is_screenshot: boolean;
  is_selfie: boolean;
  is_portrait: boolean;
  is_panorama: boolean;
  is_hdr: boolean;
  is_slow_mo: boolean;
  is_burst: boolean;
  width: number | null;
  height: number | null;
  original_filesize: number | null;
  latitude: number | null;
  longitude: number | null;
  place: string | null;
  place_country_code: string | null;
  place_address: string | null;
  camera_make: string | null;
  camera_model: string | null;
  has_edited: boolean;
  // False when only a smaller derivative is on disk (Optimize Mac Storage).
  original_available?: boolean;
  has_live_photo_video: boolean;
  people: string[];
  albums: string[];
}

// P1.16 Viewer's info panel/sheet. Same access check as every other
// library-scoped route (`require_library_assignment`): a foreign asset id
// 404s here exactly like it does for `thumb`/`original`.
export function getAssetDetail(libraryId: number, assetId: string): Promise<AssetDetailResponse> {
  return request<AssetDetailResponse>(`/api/libraries/${libraryId}/assets/${assetId}`);
}

// D21: desktop Info panel with 2+ photos selected.
export interface SelectionSummary {
  count: number;
  photos: number;
  videos: number;
  date_first: string | null;
  date_last: string | null;
  total_bytes: number;
  place: string | null;
}

export function getSelectionSummary(libraryId: number, assetIds: string[]): Promise<SelectionSummary> {
  return mutate<SelectionSummary>("POST", `/api/libraries/${libraryId}/selection-summary`, { asset_ids: assetIds });
}

// P2.3: map clusters. `bbox` is west,south,east,north in degrees.
export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MapCluster {
  lat: number;
  lon: number;
  count: number;
  cover_id: string;
  bounds: MapBounds;
}

export function getMapClusters(
  libraryId: number,
  bbox: MapBounds | null,
  zoom: number,
): Promise<{ clusters: MapCluster[]; total: number; truncated?: boolean }> {
  const params = new URLSearchParams({ zoom: String(Math.max(0, Math.min(22, Math.floor(zoom)))) });
  if (bbox) params.set("bbox", `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`);
  return request(`/api/libraries/${libraryId}/map?${params.toString()}`);
}

// The admin's `Map tiles` setting, readable by any signed-in user. A Local
// file whose archive is missing is already reported here as "off".
export interface MapConfig {
  mode: "online" | "local_file" | "off";
  pmtiles_url: string | null;
}

export function getMapConfig(): Promise<MapConfig> {
  return request<MapConfig>("/api/map/config");
}
