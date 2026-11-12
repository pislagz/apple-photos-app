import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "../testHelpers";
import SettingsScreen from "./SettingsScreen";

const SETTINGS = {
  session_lifetime_desktop_seconds: 3600,
  session_lifetime_pwa_seconds: 7200,
  session_lifetime_remember_me_seconds: 2592000,
  keep_signed_in_mode: "default_on" as "default_on" | "default_off" | "disabled",
  thumb_size_grid: 256,
  thumb_size_grid2x: 512,
  thumb_size_preview: 1024,
  thumb_quality: 85,
  zip_size_limit_bytes: 2147483648,
  map_tiles_mode: "off" as "online" | "local_file" | "off",
  map_tiles_pmtiles_path: null as string | null,
  osm_consent: false,
  library_check_interval_minutes: 15,
  library_stable_minutes: 10,
  show_library_updated_note: true,
};

const PLACE_NAMES = {
  dataset: "cities15000",
  downloaded: false,
  size_bytes: 0,
  source_url: "https://download.geonames.org/export/dump/cities15000.zip",
  attribution: "Place names from GeoNames (https://www.geonames.org), CC BY 4.0.",
  license_url: "https://creativecommons.org/licenses/by/4.0/",
  consent_decided: false,
  consent: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsScreen", () => {
  it("loads settings and the tailnet allow-list", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/settings") return SETTINGS;
      if (url === "/api/admin/place-names") return PLACE_NAMES;
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
      if (url === "/api/admin/place-names") return PLACE_NAMES;
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
      if (url === "/api/admin/place-names") return PLACE_NAMES;
      if (url === "/api/admin/settings/tailnet-allowlist") return { identities: [] };
      throw new Error(`unexpected request: ${url}`);
    });

    render(<SettingsScreen />);
    fireEvent.click(await screen.findByLabelText(/Manual only/));
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
    const field = await screen.findByLabelText(/Check libraries for changes every/);
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
    const field = await screen.findByLabelText(/Check libraries for changes every/);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.change(field, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await screen.findByText("Settings saved.");
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(put[1].body as string).library_check_interval_minutes).toBe(30);
  });

  it("shows 0 as Manual only and hides the interval field", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/settings") return { ...SETTINGS, library_check_interval_minutes: 0 };
      if (url === "/api/admin/settings/tailnet-allowlist") return { identities: [] };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<SettingsScreen />);
    expect(await screen.findByLabelText(/Manual only/)).toBeChecked();
    expect(screen.queryByLabelText(/Check libraries for changes every/)).not.toBeInTheDocument();
    expect(screen.getByText(/only checked when you press "Check now"/)).toBeInTheDocument();
  });

  it("turning Manual only off goes back to a real interval, and both timing fields allow 7 days", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/settings" && init?.method === "PUT") return JSON.parse(String(init.body));
      if (url === "/api/admin/settings") return { ...SETTINGS, library_check_interval_minutes: 0 };
      if (url === "/api/admin/settings/tailnet-allowlist") return { identities: [] };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<SettingsScreen />);
    fireEvent.click(await screen.findByLabelText(/Manual only/));
    const interval = screen.getByLabelText(/Check libraries for changes every/);
    expect(interval).toHaveValue(15);
    expect(interval).toHaveAttribute("max", "10080");
    expect(screen.getByLabelText(/unchanged for/)).toHaveAttribute("max", "10080");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await screen.findByText("Settings saved.");
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(put[1].body as string).library_check_interval_minutes).toBe(15);
  });

  it("Check now posts once and says when a check is already running", async () => {
    let started = true;
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/libraries/check-now" && init?.method === "POST") return jsonResponse({ started }, 202);
      if (url === "/api/admin/settings") return SETTINGS;
      if (url === "/api/admin/place-names") return PLACE_NAMES;
      if (url === "/api/admin/settings/tailnet-allowlist") return { identities: [] };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<SettingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Check now" }));
    expect(await screen.findByText(/Checking all libraries for changes now/)).toBeInTheDocument();
    started = false;
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText("A check is already running.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/libraries/check-now")).toHaveLength(2);
  });

  it("has one 'Map & place names' consent, off by default, and saves it", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/settings" && init?.method === "PUT") return JSON.parse(String(init.body));
      if (url === "/api/admin/settings") return SETTINGS;
      if (url === "/api/admin/place-names") return PLACE_NAMES;
      if (url === "/api/admin/settings/tailnet-allowlist") return { identities: [] };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<SettingsScreen />);
    const allow = (await screen.findByLabelText("Allow")) as HTMLInputElement;
    expect(allow.checked).toBe(false);
    const section = screen.getByTestId("map-place-names");
    expect(section.id).toBe("map-place-names");
    expect(section).toHaveTextContent("This app works fully offline.");
    expect(section).toHaveTextContent("Nothing about your photos is sent.");
    expect(screen.getByLabelText(/Local map file \(PMTiles\)/)).toBeInTheDocument();
    expect(screen.getByTestId("geonames-attribution")).toHaveTextContent("GeoNames");
    expect(screen.getByTestId("place-names-status")).toHaveTextContent("not downloaded");
    // No consent: the one outbound request cannot be started.
    expect(screen.getByRole("button", { name: "Download place-name data" })).toBeDisabled();

    fireEvent.click(allow);
    expect(screen.getByRole("button", { name: "Download place-name data" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await screen.findByText("Settings saved.");
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put![1]!.body))).toMatchObject({ osm_consent: true });
  });

  it("downloads the place-name data on an explicit click and shows the result", async () => {
    let downloaded = false;
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/settings") return { ...SETTINGS, osm_consent: true };
      if (url === "/api/admin/place-names/download" && init?.method === "POST") {
        downloaded = true;
        return { ...PLACE_NAMES, downloaded: true, size_bytes: 2_097_152 };
      }
      if (url === "/api/admin/place-names") return { ...PLACE_NAMES, downloaded };
      if (url === "/api/admin/settings/tailnet-allowlist") return { identities: [] };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<SettingsScreen />);
    await screen.findByLabelText("Allow");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/download"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Download place-name data" }));
    await waitFor(() => expect(screen.getByTestId("place-names-status")).toHaveTextContent("downloaded (2048 KB)"));
  });
});
