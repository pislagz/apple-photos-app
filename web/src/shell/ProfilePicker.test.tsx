import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "../testHelpers";
import AppShell from "./AppShell";

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: query === "(pointer: fine)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const PROFILES = {
  profiles: [
    { id: 1, display_name: "ann", avatar_url: "/api/auth/profiles/1/avatar?v=3" },
    { id: 2, display_name: "kid", avatar_url: null },
  ],
};
const ME = { username: "ann", role: "user", libraries: [], layout_override: null, has_password: true };

function server(opts: { profiles?: unknown; profileLogin?: (body: Record<string, unknown>) => Response }) {
  let signedIn = false;
  const fetchMock = mockFetch((url, init) => {
    if (url === "/api/setup/status") return { needs_setup: false };
    if (url === "/api/auth/profiles") {
      return opts.profiles === undefined ? jsonResponse({ detail: "not found" }, 404) : opts.profiles;
    }
    if (url === "/api/auth/profile-login") {
      const result = opts.profileLogin!(JSON.parse(String(init?.body)));
      if (result.ok) signedIn = true;
      return result;
    }
    if (url === "/api/me") return signedIn ? ME : jsonResponse({ detail: "no" }, 401);
    if (url === "/api/auth/login") return { username: "x", role: "user" };
    return jsonResponse({}, 200);
  });
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Family login profile screen (#519)", () => {
  it("shows every profile with its name and avatar, then Other user…", async () => {
    setViewport(1400);
    server({ profiles: PROFILES });
    render(<AppShell />);
    expect(await screen.findByRole("heading", { name: "Who’s watching?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ann" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "kid" })).toBeTruthy();
    expect(document.querySelector('img[src="/api/auth/profiles/1/avatar?v=3"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Other user…" })).toBeTruthy();
    expect(screen.queryByLabelText("Username")).toBeNull();
  });

  it("uses the two-column iPhone layout on a phone", async () => {
    setViewport(390);
    server({ profiles: PROFILES });
    render(<AppShell />);
    const title = await screen.findByRole("heading", { name: "Who’s watching?" });
    expect(title.closest(".login-screen--mobile")).not.toBeNull();
  });

  it("falls back to the normal sign-in when Family login is off", async () => {
    setViewport(1400);
    server({});
    render(<AppShell />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to profiles" })).toBeNull();
  });

  it("signs a passwordless profile in with one tap", async () => {
    setViewport(1400);
    const fetchMock = server({
      profiles: PROFILES,
      profileLogin: () => jsonResponse({ username: "kid", role: "user" }),
    });
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: "kid" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Who’s watching?" })).toBeNull());
    const call = fetchMock.mock.calls.find(([u]) => u === "/api/auth/profile-login")!;
    expect(JSON.parse(String(call[1].body))).toMatchObject({ user_id: 2, password: "" });
  });

  it("asks for the password when the server says it is required", async () => {
    setViewport(1400);
    const attempts: string[] = [];
    server({
      profiles: PROFILES,
      profileLogin: (body) => {
        attempts.push(String(body.password));
        if (body.password === "") {
          return jsonResponse({ detail: { code: "password_required", message: "password required" } }, 401);
        }
        return body.password === "right-password"
          ? jsonResponse({ username: "ann", role: "user" })
          : jsonResponse({ detail: "invalid username or password" }, 401);
      },
    });
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: "ann" }));
    const input = await screen.findByLabelText("Password");
    expect(screen.getByRole("heading", { name: "ann" })).toBeTruthy();
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Wrong password/);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "right-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.queryByLabelText("Password")).toBeNull());
    expect(attempts).toEqual(["", "nope", "right-password"]);
  });

  it("explains a passwordless profile that is blocked on this network", async () => {
    setViewport(1400);
    server({
      profiles: PROFILES,
      profileLogin: () =>
        jsonResponse({ detail: { code: "passwordless_network", message: "Only from your home or Tailscale network." } }, 403),
    });
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: "kid" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/home or Tailscale network/);
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Who’s watching?" })).toBeTruthy();
  });

  it("Other user… opens the normal form, which can go back to the profiles", async () => {
    setViewport(1400);
    server({ profiles: PROFILES });
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: "Other user…" }));
    expect(await screen.findByLabelText("Username")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to profiles" }));
    expect(await screen.findByRole("heading", { name: "Who’s watching?" })).toBeTruthy();
  });
});
