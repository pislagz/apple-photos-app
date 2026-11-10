import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminApp from "./AdminApp";
import { jsonResponse, mockFetch } from "./testHelpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminApp", () => {
  it("shows a sign-in form when there is no session", async () => {
    mockFetch((url) => {
      if (url === "/api/me") return jsonResponse({ detail: "not signed in" }, 401);
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AdminApp />);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("rejects a non-admin account", async () => {
    mockFetch((url) => {
      if (url === "/api/me") return { username: "bob", role: "user", libraries: [] };
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AdminApp />);

    expect(await screen.findByText("This account is not an admin.")).toBeInTheDocument();
  });

  it("shows the sidebar and Libraries screen for an admin", async () => {
    mockFetch((url) => {
      if (url === "/api/me") return { username: "alice", role: "admin", libraries: [] };
      if (url === "/api/admin/libraries") return [];
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AdminApp />);

    expect(await screen.findByRole("heading", { name: "Libraries" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Access" })).toBeInTheDocument();
  });

  it("logs in and then shows the admin sidebar", async () => {
    let signedIn = false;
    mockFetch((url, init) => {
      if (url === "/api/me") {
        return signedIn ? { username: "alice", role: "admin", libraries: [] } : jsonResponse({ detail: "not signed in" }, 401);
      }
      if (url === "/api/auth/login" && init?.method === "POST") {
        signedIn = true;
        return { username: "alice", role: "admin" };
      }
      if (url === "/api/admin/libraries") return [];
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    render(<AdminApp />);
    await screen.findByRole("heading", { name: "Sign in" });

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Libraries" })).toBeInTheDocument());
  });

  it("asks the 'Map & place names' question once, until it is answered", async () => {
    let reviewed = false;
    mockFetch((url) => {
      if (url === "/api/me") return { username: "alice", role: "admin", libraries: [] };
      if (url === "/api/admin/libraries") return [];
      if (url === "/api/admin/place-names") {
        return { dataset: "cities15000", downloaded: false, size_bytes: 0, source_url: "", attribution: "", license_url: "", consent_decided: reviewed, consent: false };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { unmount } = render(<AdminApp />);
    expect(await screen.findByTestId("opt-in-notice")).toHaveTextContent("agree to use OpenStreetMap data");
    unmount();
    reviewed = true;
    render(<AdminApp />);
    await screen.findByRole("heading", { name: "Libraries" });
    await waitFor(() => expect(screen.queryByTestId("opt-in-notice")).toBeNull());
  });

  it("opens Settings from the #map-place-names deep link", async () => {
    window.history.replaceState({}, "", "/admin#map-place-names");
    mockFetch((url) => {
      if (url === "/api/me") return { username: "alice", role: "admin", libraries: [] };
      if (url === "/api/admin/place-names") {
        return { dataset: "cities15000", downloaded: false, size_bytes: 0, source_url: "", attribution: "", license_url: "", consent_decided: true, consent: false };
      }
      if (url === "/api/admin/settings") return { osm_consent: false, map_tiles_pmtiles_path: null, session_lifetime_desktop_seconds: 1, session_lifetime_pwa_seconds: 1, session_lifetime_remember_me_seconds: 1, thumb_size_grid: 1, thumb_size_grid2x: 1, thumb_size_preview: 1, thumb_quality: 1, zip_size_limit_bytes: 1, map_tiles_mode: "off", library_check_interval_minutes: 1, library_stable_minutes: 1, show_library_updated_note: true };
      if (url === "/api/admin/settings/tailnet-allowlist") return { identities: [] };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<AdminApp />);
    expect(await screen.findByTestId("map-place-names")).toBeInTheDocument();
    window.history.replaceState({}, "", "/");
  });
});
