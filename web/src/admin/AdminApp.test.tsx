import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
      if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
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
      if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    render(<AdminApp />);
    await screen.findByRole("heading", { name: "Sign in" });

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Libraries" })).toBeInTheDocument());
  });

  const status = (consent_decided: boolean, consent = false, downloaded = false) => ({
    dataset: "cities15000",
    downloaded,
    size_bytes: 0,
    source_url: "",
    attribution: "",
    license_url: "",
    consent_decided,
    consent,
  });

  it("asks the 'Map & place names' question once, until it is answered", async () => {
    let reviewed = false;
    mockFetch((url) => {
      if (url === "/api/me") return { username: "alice", role: "admin", libraries: [] };
      if (url === "/api/admin/libraries") return [];
      if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
      if (url === "/api/admin/place-names") return status(reviewed);
      throw new Error(`unexpected request: ${url}`);
    });
    const { unmount } = render(<AdminApp />);
    const notice = await screen.findByTestId("opt-in-notice");
    expect(notice).toHaveTextContent("agree to use OpenStreetMap data");
    expect(within(notice).getByRole("button", { name: "Allow" })).toBeInTheDocument();
    expect(within(notice).getByRole("button", { name: "Not now" })).toBeInTheDocument();
    unmount();
    reviewed = true;
    render(<AdminApp />);
    await screen.findByRole("heading", { name: "Libraries" });
    await waitFor(() => expect(screen.queryByTestId("opt-in-notice")).toBeNull());
  });

  it("Allow records the answer, then downloads the place names and shows the progress", async () => {
    const calls: string[] = [];
    let finishDownload: () => void = () => undefined;
    // The download is held open so the in-progress text can be seen.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/me") return jsonResponse({ username: "alice", role: "admin", libraries: [] });
        if (url === "/api/admin/libraries") return jsonResponse([]);
        if (url === "/api/admin/library-candidates") return jsonResponse({ folders: [], candidates: [] });
        if (url === "/api/admin/place-names") return jsonResponse(status(false));
        calls.push(`${init?.method} ${url}`);
        if (url === "/api/admin/place-names/consent") return jsonResponse(status(true, true));
        if (url === "/api/admin/place-names/download") {
          return new Promise<Response>((resolve) => {
            finishDownload = () => resolve(jsonResponse(status(true, true, true)));
          });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    expect(await screen.findByTestId("place-names-progress")).toHaveTextContent("Downloading place-name data");
    expect(screen.queryByTestId("opt-in-notice")).toBeNull();
    finishDownload();
    await waitFor(() => expect(screen.getByTestId("place-names-progress")).toHaveTextContent("downloaded"));
    expect(calls).toEqual(["PUT /api/admin/place-names/consent", "POST /api/admin/place-names/download"]);
  });

  it("a failed automatic download says so and Retry tries again", async () => {
    let attempts = 0;
    mockFetch((url) => {
      if (url === "/api/me") return { username: "alice", role: "admin", libraries: [] };
      if (url === "/api/admin/libraries") return [];
      if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
      if (url === "/api/admin/place-names") return status(false);
      if (url === "/api/admin/place-names/consent") return status(true, true);
      if (url === "/api/admin/place-names/download") {
        attempts += 1;
        return attempts === 1 ? jsonResponse({ detail: "no route to host" }, 502) : status(true, true, true);
      }
      throw new Error(`unexpected request: ${url}`);
    });
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    expect(await screen.findByTestId("place-names-progress")).toHaveTextContent("no route to host");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("place-names-progress")).toHaveTextContent("downloaded"));
  });

  it("Not now records the answer, hides the notice and downloads nothing", async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      if (url === "/api/me") return { username: "alice", role: "admin", libraries: [] };
      if (url === "/api/admin/libraries") return [];
      if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
      if (url === "/api/admin/place-names") return status(false);
      calls.push(`${init?.method} ${url} ${init?.body ?? ""}`);
      if (url === "/api/admin/place-names/consent") return status(true, false);
      throw new Error(`unexpected request: ${url}`);
    });
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByTestId("opt-in-notice")).toBeNull());
    expect(screen.queryByTestId("place-names-progress")).toBeNull();
    expect(calls).toEqual(['PUT /api/admin/place-names/consent {"agree":false}']);
  });

  it("opens Settings from the #map-place-names deep link", async () => {
    window.history.replaceState({}, "", "/admin#map-place-names");
    mockFetch((url) => {
      if (url === "/api/me") return { username: "alice", role: "admin", libraries: [] };
      if (url === "/api/admin/place-names") {
        return { dataset: "cities15000", downloaded: false, size_bytes: 0, source_url: "", attribution: "", license_url: "", consent_decided: true, consent: false };
      }
      if (url === "/api/admin/settings") return { osm_consent: false, map_tiles_pmtiles_path: null, session_lifetime_desktop_seconds: 1, session_lifetime_pwa_seconds: 1, session_lifetime_remember_me_seconds: 1, keep_signed_in_mode: "default_on", thumb_size_grid: 1, thumb_size_grid2x: 1, thumb_size_preview: 1, thumb_quality: 1, zip_size_limit_bytes: 1, map_tiles_mode: "off", library_check_interval_minutes: 1, library_stable_minutes: 1, show_library_updated_note: true };
      if (url === "/api/admin/settings/tailnet-allowlist") return { identities: [] };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<AdminApp />);
    expect(await screen.findByTestId("map-place-names")).toBeInTheDocument();
    window.history.replaceState({}, "", "/");
  });

  describe("leaving Admin (#253)", () => {
    function adminFetch() {
      mockFetch((url) => {
        if (url === "/api/me") return { username: "alice", role: "admin", libraries: [] };
        if (url === "/api/admin/libraries") return [];
        if (url === "/api/admin/place-names") return { consent_decided: true };
        return [];
      });
    }

    function stubAssign() {
      const assign = vi.fn();
      vi.stubGlobal("location", { ...window.location, assign, hash: "", pathname: "/admin" });
      return assign;
    }

    it("shows a Photos back link to the library in the sidebar", async () => {
      adminFetch();
      render(<AdminApp />);
      await screen.findByRole("heading", { name: "Libraries" });
      const nav = screen.getByRole("navigation", { name: "Admin sections" });
      const back = within(nav).getByRole("link", { name: "Photos" });
      expect(back).toHaveAttribute("href", "/");
    });

    it("offers the way back on the not-an-admin screen too", async () => {
      mockFetch((url) => {
        if (url === "/api/me") return { username: "bob", role: "user", libraries: [] };
        throw new Error(`unexpected request: ${url}`);
      });
      render(<AdminApp />);
      expect(await screen.findByRole("link", { name: "Photos" })).toHaveAttribute("href", "/");
    });

    it("Esc returns to the library", async () => {
      adminFetch();
      const assign = stubAssign();
      render(<AdminApp />);
      await screen.findByRole("heading", { name: "Libraries" });
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(assign).toHaveBeenCalledWith("/");
    });

    it("Esc in a text field or with a dialog open stays in Admin", async () => {
      adminFetch();
      const assign = stubAssign();
      render(<AdminApp />);
      await screen.findByRole("heading", { name: "Libraries" });
      const field = document.createElement("input");
      document.body.appendChild(field);
      fireEvent.keyDown(field, { key: "Escape" });
      field.remove();
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      document.body.appendChild(dialog);
      fireEvent.keyDown(document.body, { key: "Escape" });
      dialog.remove();
      expect(assign).not.toHaveBeenCalled();
    });
  });
});
