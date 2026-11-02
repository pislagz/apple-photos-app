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
}

export interface AssetListResponse {
  items: AssetListItem[];
  next_cursor: string | null;
}

// Apple Photos' Hidden album (P1.13): the only list a hidden asset appears
// in. Every other route excludes it.
export function getHidden(libraryId: number): Promise<AssetListResponse> {
  return request<AssetListResponse>(`/api/libraries/${libraryId}/hidden`);
}
