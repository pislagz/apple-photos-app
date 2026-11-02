// Thin fetch wrapper for the P1.10 admin API (`admin_panel.py`,
// `session_auth.py`, `library_admin.py`). No client library, no CDN --
// just `fetch` against same-origin paths, matching the server's CSRF check
// (`_reject_cross_site_requests`): every mutating call gets a JSON
// Content-Type, even with no body.

export class ApiError extends Error {
  status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include" });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // no JSON body; fall back to statusText
    }
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function mutate<T>(method: string, path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export type Role = "admin" | "user";

export interface MeResponse {
  username: string;
  role: Role;
  libraries: { id: number; display_name: string }[];
}

export interface AuthUserResponse {
  username: string;
  role: Role;
}

export function getMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/me");
}

export function login(username: string, password: string, rememberMe = false): Promise<AuthUserResponse> {
  return mutate<AuthUserResponse>("POST", "/api/auth/login", {
    username,
    password,
    remember_me: rememberMe,
    client: "desktop",
  });
}

export function logout(): Promise<void> {
  return mutate<void>("POST", "/api/auth/logout");
}

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
