// Thin fetch wrapper shared by the main shell and the admin panel. No
// client library, no CDN -- just `fetch` against same-origin paths,
// matching the server's CSRF check (`session_auth._reject_cross_site_requests`):
// every mutating call gets a JSON Content-Type, even with no body.

export class ApiError extends Error {
  status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
}

export interface AuthUserResponse {
  username: string;
  role: Role;
}

export function getMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/me");
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
