// Admin-only endpoints (`admin_panel.py`, `session_auth.py`,
// `library_admin.py`). The fetch wrapper, session/login calls, and shared
// types live in `../api`, since the P1.11 shell needs them too; re-exported
// here so the existing admin screen imports (`from "./api"`) don't change.

export { ApiError, type Role, type MeResponse, type AuthUserResponse, getMe, login, logout } from "../api";
import { mutate, request, type Role } from "../api";

// -- Libraries -------------------------------------------------------------

export interface LibraryResponse {
  id: number;
  display_name: string;
  path: string;
  created_at: string;
}

export interface LibraryWarning {
  code: string;
  message: string;
}

export interface LibraryStatusResponse {
  id: number;
  display_name: string;
  path: string;
  asset_count: number | null;
  video_count: number | null;
  people_count: number | null;
  total_size_bytes: number | null;
  last_indexed_at: string | null;
  prewarm_progress: number | null;
  warnings: LibraryWarning[];
  updating?: boolean;
  updating_reason?: string | null;
  last_update?: RunSummary | null;
  runs?: RunSummary[];
  suggestion?: ReplaceSuggestion | null;
}

export interface RunSummary {
  id: number;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  outcome: string;
  asset_count: number | null;
  added: number | null;
  removed: number | null;
  changed: number | null;
  hidden_changed: number | null;
  originals_missing: number;
  originals_missing_pct: number;
  error: string | null;
  summary: string;
}

export interface ReplaceSuggestion {
  path: string;
  name: string;
  message: string;
}

export interface ReplacePreview {
  path: string;
  confirmed: boolean;
  new_asset_count: number;
  would_add: number;
  would_remove: number;
  overlap: number;
  store_uuid_match: boolean | null;
  originals_missing: number;
  originals_missing_pct: number;
  warnings: LibraryWarning[];
  status: LibraryStatusResponse | null;
}

// Without `confirm` this is a read-only preview. `replaceAnyway` is only
// needed when the preview carries warnings other than originals_missing.
export function replaceLibrary(
  id: number,
  path: string,
  options: { confirm?: boolean; replaceAnyway?: boolean } = {},
): Promise<ReplacePreview> {
  return mutate<ReplacePreview>("POST", `/api/admin/libraries/${id}/replace`, {
    path,
    confirm: options.confirm ?? false,
    replace_anyway: options.replaceAnyway ?? false,
  });
}

export function listLibraries(): Promise<LibraryResponse[]> {
  return request<LibraryResponse[]>("/api/admin/libraries");
}

export function addLibrary(path: string, displayName?: string): Promise<LibraryResponse> {
  return mutate<LibraryResponse>("POST", "/api/admin/libraries", { path, display_name: displayName ?? null });
}

export function renameLibrary(id: number, displayName: string): Promise<LibraryResponse> {
  return mutate<LibraryResponse>("PATCH", `/api/admin/libraries/${id}`, { display_name: displayName });
}

export function removeLibrary(id: number): Promise<void> {
  return mutate<void>("DELETE", `/api/admin/libraries/${id}`);
}

export function libraryStatus(id: number): Promise<LibraryStatusResponse> {
  return request<LibraryStatusResponse>(`/api/admin/libraries/${id}/status`);
}

export function reindexLibrary(id: number): Promise<LibraryStatusResponse> {
  return mutate<LibraryStatusResponse>("POST", `/api/admin/libraries/${id}/reindex`);
}

// -- Users ------------------------------------------------------------------

export interface UserResponse {
  id: number;
  username: string;
  role: Role;
  disabled: boolean;
  created_at: string;
}

export function listUsers(): Promise<UserResponse[]> {
  return request<UserResponse[]>("/api/admin/users");
}

export function createUser(username: string, password: string, role: Role): Promise<UserResponse> {
  return mutate<UserResponse>("POST", "/api/admin/users", { username, password, role });
}

export interface UserUpdate {
  role?: Role;
  disabled?: boolean;
  password?: string;
}

export function updateUser(username: string, update: UserUpdate): Promise<UserResponse> {
  return mutate<UserResponse>("PATCH", `/api/admin/users/${encodeURIComponent(username)}`, update);
}

export function deleteUser(username: string): Promise<void> {
  return mutate<void>("DELETE", `/api/admin/users/${encodeURIComponent(username)}`);
}

export function unlockUser(username: string): Promise<{ username: string }> {
  return mutate<{ username: string }>("POST", `/api/admin/users/${encodeURIComponent(username)}/unlock`);
}

// -- Invites ------------------------------------------------------------------

export interface InviteResponse {
  id: string;
  role: Role;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface InviteCreateResponse {
  code: string;
  role: Role;
  expires_at: string;
}

export function listInvites(): Promise<InviteResponse[]> {
  return request<InviteResponse[]>("/api/admin/invites");
}

export function createInvite(role: Role): Promise<InviteCreateResponse> {
  return mutate<InviteCreateResponse>("POST", "/api/admin/invites", { role });
}

// -- Access matrix ------------------------------------------------------------------

export interface AccessMatrixResponse {
  users: UserResponse[];
  libraries: LibraryResponse[];
  assignments: Record<string, number[]>;
}

export function readAccessMatrix(): Promise<AccessMatrixResponse> {
  return request<AccessMatrixResponse>("/api/admin/access-matrix");
}

export function assignLibrary(userId: number, libraryId: number): Promise<void> {
  return mutate<void>("PUT", `/api/admin/users/${userId}/libraries/${libraryId}`);
}

export function unassignLibrary(userId: number, libraryId: number): Promise<void> {
  return mutate<void>("DELETE", `/api/admin/users/${userId}/libraries/${libraryId}`);
}

// -- Sessions ------------------------------------------------------------------

export interface SessionResponse {
  id: string;
  username: string;
  device: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  remember_me: boolean;
}

export function listSessions(): Promise<SessionResponse[]> {
  return request<SessionResponse[]>("/api/admin/sessions");
}

export function revokeSession(id: string): Promise<void> {
  return mutate<void>("DELETE", `/api/admin/sessions/${encodeURIComponent(id)}`);
}

// -- Audit log ------------------------------------------------------------------

export interface AuditLogEntry {
  id: number;
  occurred_at: string;
  action: string;
  actor: string | null;
  user_id: number | null;
  username: string | null;
  library_id: number | null;
  library_display_name: string | null;
  asset_id: number | null;
  detail: string | null;
}

export interface AuditLogFilters {
  userId?: number;
  libraryId?: number;
  dateFrom?: string;
  dateTo?: string;
}

function auditLogQuery(filters: AuditLogFilters): string {
  const params = new URLSearchParams();
  if (filters.userId !== undefined) params.set("user_id", String(filters.userId));
  if (filters.libraryId !== undefined) params.set("library_id", String(filters.libraryId));
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function readAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> {
  const result = await request<{ entries: AuditLogEntry[] }>(`/api/admin/audit-log${auditLogQuery(filters)}`);
  return result.entries;
}

export function auditLogCsvUrl(filters: AuditLogFilters = {}): string {
  return `/api/admin/audit-log.csv${auditLogQuery(filters)}`;
}

// -- Settings ------------------------------------------------------------------

export type MapTilesMode = "online" | "local_file" | "off";

export interface SettingsResponse {
  session_lifetime_desktop_seconds: number;
  session_lifetime_pwa_seconds: number;
  session_lifetime_remember_me_seconds: number;
  thumb_size_grid: number;
  thumb_size_grid2x: number;
  thumb_size_preview: number;
  thumb_quality: number;
  zip_size_limit_bytes: number;
  map_tiles_mode: MapTilesMode;
  map_tiles_pmtiles_path: string | null;
  library_check_interval_minutes: number;
  library_stable_minutes: number;
  show_library_updated_note: boolean;
}

export function readSettings(): Promise<SettingsResponse> {
  return request<SettingsResponse>("/api/admin/settings");
}

export function writeSettings(settings: SettingsResponse): Promise<SettingsResponse> {
  return mutate<SettingsResponse>("PUT", "/api/admin/settings", settings);
}

export interface TailnetAllowlistResponse {
  identities: string[];
}

export function readTailnetAllowlist(): Promise<TailnetAllowlistResponse> {
  return request<TailnetAllowlistResponse>("/api/admin/settings/tailnet-allowlist");
}

export function writeTailnetAllowlist(identities: string[]): Promise<TailnetAllowlistResponse> {
  return mutate<TailnetAllowlistResponse>("PUT", "/api/admin/settings/tailnet-allowlist", { identities });
}
