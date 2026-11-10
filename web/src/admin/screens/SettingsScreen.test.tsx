import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "../testHelpers";
import SettingsScreen from "./SettingsScreen";

const SETTINGS = {
  session_lifetime_desktop_seconds: 3600,
  session_lifetime_pwa_seconds: 7200,
  session_lifetime_remember_me_seconds: 2592000,
  thumb_size_grid: 256,
  thumb_size_grid2x: 512,
  thumb_size_preview: 1024,
  thumb_quality: 85,
  zip_size_limit_bytes: 2147483648,
  map_tiles_mode: "online" as const,
  map_tiles_pmtiles_path: null,
  library_check_interval_minutes: 15,
  library_stable_minutes: 10,
  show_library_updated_note: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsScreen", () => {
  it("loads settings and the tailnet allow-list", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/settings") return SETTINGS;
      if (url === "/api/admin/settings/tailnet-allowlist") return { identities: ["alice@example.ts.net"] };
      throw new Error(`unexpected request: ${url}`);
    });

    render(<SettingsScreen />);

    expect(await screen.findByDisplayValue("alice@example.ts.net")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3600")).toBeInTheDocument();
  });

  it("shows the server's rejection message for a self-lockout allow-list", async () => {
    mockFetch((url, init) => {
      if (url === "/api/admin/settings") return SETTINGS;
      if (url === "/api/admin/settings/tailnet-allowlist" && (init?.method ?? "GET") === "GET") {
        return { identities: [] };
      }
      if (url === "/api/admin/settings/tailnet-allowlist" && init?.method === "PUT") {
        return jsonResponse({ detail: "allow-list must include your own tailnet identity, or you would be locked out" }, 400);
      }
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    render(<SettingsScreen />);
    await screen.findByDisplayValue("3600");

    fireEvent.change(screen.getByLabelText("Identities, one per line"), { target: { value: "someone-else@example.ts.net" } });
    fireEvent.click(screen.getByRole("button", { name: "Save allow-list" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("locked out");
    await waitFor(() => expect(screen.getByLabelText("Identities, one per line")).toHaveValue("someone-else@example.ts.net"));
  });

  it("saves the library check settings", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/settings" && init?.method === "PUT") return JSON.parse(String(init.body));
      if (url === "/api/admin/settings") return SETTINGS;
      if (url === "/api/admin/settings/tailnet-allowlist") return { identities: [] };
      throw new Error(`unexpected request: ${url}`);
    });

    render(<SettingsScreen />);
    fireEvent.change(await screen.findByLabelText(/Library check interval/), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText(/unchanged for/), { target: { value: "30" } });
    fireEvent.click(screen.getByLabelText(/Tell users when their library was updated/));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await screen.findByText("Settings saved.");
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT" && String(init.body).includes("library_"));
    expect(JSON.parse(String(put![1]!.body))).toMatchObject({
      library_check_interval_minutes: 0,
      library_stable_minutes: 30,
      show_library_updated_note: false,
    });
  });

  it("an emptied number field blocks the save instead of saving 0 (#185)", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/settings" && (init?.method ?? "GET") === "GET") return SETTINGS;
      if (url === "/api/admin/settings/tailnet-allowlist") return { identities: [] };
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });
    render(<SettingsScreen />);
    const field = await screen.findByLabelText(/Library check interval/);
    fireEvent.change(field, { target: { value: "" } });
    expect(field).toHaveValue(null);
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a number");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("a number typed after emptying the field is saved", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/settings" && (init?.method ?? "GET") === "GET") return SETTINGS;
      if (url === "/api/admin/settings" && init?.method === "PUT") return { ...SETTINGS, library_check_interval_minutes: 30 };
      if (url === "/api/admin/settings/tailnet-allowlist") return { identities: [] };
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });
    render(<SettingsScreen />);
    const field = await screen.findByLabelText(/Library check interval/);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.change(field, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await screen.findByText("Settings saved.");
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(put[1].body as string).library_check_interval_minutes).toBe(30);
  });
});
