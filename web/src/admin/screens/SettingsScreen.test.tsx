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
});
