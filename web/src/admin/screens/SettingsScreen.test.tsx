import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "../testHelpers";
import { HELP, type HelpKey } from "../../help/adminHelp";
import SettingsScreen from "./SettingsScreen";

const SETTINGS = {
  session_lifetime_desktop_seconds: 43200,
  session_lifetime_pwa_seconds: 2592000,
  session_lifetime_remember_me_seconds: 15552000,
  keep_signed_in_mode: "default_on" as "default_on" | "default_off" | "disabled",
  thumb_size_grid: 300,
  thumb_size_grid2x: 600,
  thumb_size_preview: 1600,
  thumb_quality: 82,
  media_cache_size_limit_bytes: 5 * 1024 ** 3,
  zip_size_limit_bytes: 2 * 1024 ** 3,
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

type Stored = typeof SETTINGS;

// Serves the screen; PATCH merges into the stored settings like the server.
function serve(initial: Partial<Stored> = {}, extra?: (url: string, init?: RequestInit) => unknown) {
  let current: Stored = { ...SETTINGS, ...initial };
  return mockFetch((url, init) => {
    const custom = extra?.(url, init);
    if (custom !== undefined) return custom;
    if (url === "/api/admin/settings" && init?.method === "PATCH") {
      current = { ...current, ...JSON.parse(String(init.body)) };
      return current;
    }
    if (url === "/api/admin/settings") return current;
    if (url === "/api/admin/place-names") return PLACE_NAMES;
    if (url === "/api/admin/settings/tailnet-allowlist") return { identities: [] };
    throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
  });
}

function patches(fetchMock: ReturnType<typeof serve>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => JSON.parse(String(init!.body)));
}

function tipFor(name: string) {
  const button = screen.getByRole("button", { name: `About ${name}` });
  return document.getElementById(button.getAttribute("aria-describedby")!)!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsScreen words and (i) buttons", () => {
  it("every row has an (i) with its registered text", async () => {
    serve();
    render(<SettingsScreen />);
    await screen.findByLabelText("On computers");
    const rows: [string, HelpKey][] = [
      ["sign-in time on computers", "sessionDesktop"],
      ["sign-in time on the Home Screen app", "sessionPwa"],
      ["sign-in time with Keep me signed in", "sessionRememberMe"],
      ["keep me signed in on the sign-in screen", "keepSignedInMode"],
      ["largest download", "zipLimit"],
      ["picture quality", "pictureQuality"],
      ["space for pictures", "cacheSize"],
      ["how often to check", "checkInterval"],
      ["wait time", "stableMinutes"],
      ["library updated message", "updatedNote"],
      ["Check now", "checkNow"],
      ["map and place names", "mapConsent"],
      ["place-name data download", "placeNamesDownload"],
      ["who can open the app", "allowlist"],
      ["offline map file", "mapFile"],
    ];
    for (const [name, key] of rows) {
      expect(tipFor(name).textContent, name).toBe(HELP[key]);
    }
  });

  it("shows no technical words outside an (i)", async () => {
    serve();
    const { container } = render(<SettingsScreen />);
    await screen.findByLabelText("On computers");
    const visible = Array.from(container.querySelectorAll("*"))
      .flatMap((el) => [el.textContent ?? "", el.getAttribute("aria-label") ?? "", el.getAttribute("placeholder") ?? ""])
      .join(" ")
      .toLowerCase();
    for (const word of ["seconds", "bytes", "pwa", "pmtiles", "tailnet"]) {
      expect(visible, word).not.toContain(word);
    }
  });
});

describe("SettingsScreen instant save", () => {
  it("shows a stored 43200 as 12 hours and has no Save button", async () => {
    serve();
    render(<SettingsScreen />);
    const select = (await screen.findByLabelText("On computers")) as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe("12 hours");
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("changing a choice sends exactly that field in seconds right away and says Saved", async () => {
    const fetchMock = serve();
    render(<SettingsScreen />);
    fireEvent.change(await screen.findByLabelText("On computers"), { target: { value: "604800" } });
    await screen.findByText("Saved");
    expect(patches(fetchMock)).toEqual([{ session_lifetime_desktop_seconds: 604800 }]);
  });

  it("the other session menus send seconds too", async () => {
    const fetchMock = serve();
    render(<SettingsScreen />);
    fireEvent.change(await screen.findByLabelText("On the Home Screen app"), { target: { value: String(90 * 86400) } });
    fireEvent.change(screen.getByLabelText(/ticked/), { target: { value: String(365 * 86400) } });
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(2));
    expect(patches(fetchMock)).toEqual([
      { session_lifetime_pwa_seconds: 7776000 },
      { session_lifetime_remember_me_seconds: 31536000 },
    ]);
  });

  it("sizes are in 1024-based bytes: 1 GB = 1024^3", async () => {
    const fetchMock = serve();
    render(<SettingsScreen />);
    const zip = (await screen.findByLabelText("Largest download at once")) as HTMLSelectElement;
    expect(zip.selectedOptions[0].textContent).toBe("2 GB");
    fireEvent.change(zip, { target: { value: String(1024 ** 3) } });
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    expect(patches(fetchMock)[0]).toEqual({ zip_size_limit_bytes: 1073741824 });
    const cache = screen.getByLabelText("Space for pictures") as HTMLSelectElement;
    expect(cache.selectedOptions[0].textContent).toBe("5 GB");
    fireEvent.change(cache, { target: { value: String(20 * 1024 ** 3) } });
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(2));
    expect(patches(fetchMock)[1]).toEqual({ media_cache_size_limit_bytes: 21474836480 });
  });

  it("Picture quality is one choice that sets sizes and quality together", async () => {
    const fetchMock = serve();
    render(<SettingsScreen />);
    const select = (await screen.findByLabelText("Picture quality")) as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe("Standard");
    fireEvent.change(select, { target: { value: "High" } });
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    expect(patches(fetchMock)[0]).toEqual({
      thumb_size_grid: 400,
      thumb_size_grid2x: 800,
      thumb_size_preview: 2400,
      thumb_quality: 90,
    });
  });

  it("check interval folds in 'Never' (0) and saves minutes", async () => {
    const fetchMock = serve({ library_check_interval_minutes: 0 });
    render(<SettingsScreen />);
    const select = (await screen.findByLabelText("Check for changes")) as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toMatch(/^Only when I ask/);
    expect(screen.queryByLabelText(/Manual only/)).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "60" } });
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ library_check_interval_minutes: 60 }]));
    fireEvent.change(screen.getByLabelText("Wait until a library stops changing"), { target: { value: "30" } });
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(2));
    expect(patches(fetchMock)[1]).toEqual({ library_stable_minutes: 30 });
  });

  it("the updated-note switch saves instantly", async () => {
    const fetchMock = serve();
    render(<SettingsScreen />);
    fireEvent.click(await screen.findByRole("switch", { name: "Tell people when a library was updated" }));
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ show_library_updated_note: false }]));
  });

  it("a failed save shows the problem on its row and keeps the stored choice", async () => {
    serve({}, (url, init) =>
      url === "/api/admin/settings" && init?.method === "PATCH" ? jsonResponse({ detail: "Not allowed" }, 400) : undefined,
    );
    render(<SettingsScreen />);
    const select = (await screen.findByLabelText("On computers")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "3600" } });
    await screen.findByText("Not allowed");
    expect(select.selectedOptions[0].textContent).toBe("12 hours");
  });

  it("a stored value with no matching choice shows the nearest label, explains it in the (i), and sends nothing", async () => {
    const fetchMock = serve({ session_lifetime_desktop_seconds: 100000 });
    render(<SettingsScreen />);
    const select = (await screen.findByLabelText("On computers")) as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe("1 day");
    const tip = tipFor("sign-in time on computers").textContent!;
    expect(tip).toContain("100,000 seconds");
    expect(tip).toContain(HELP.sessionDesktop);
    expect(patches(fetchMock)).toEqual([]);
    // Another row's save does not touch it either.
    fireEvent.click(screen.getByRole("switch", { name: "Tell people when a library was updated" }));
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    expect(patches(fetchMock)[0]).not.toHaveProperty("session_lifetime_desktop_seconds");
  });

  it("an odd size or cache value keeps its exact bytes in the (i)", async () => {
    serve({ zip_size_limit_bytes: 3 * 1024 ** 3 + 5, thumb_size_grid: 123 });
    render(<SettingsScreen />);
    await screen.findByLabelText("Largest download at once");
    expect(tipFor("largest download").textContent).toContain("3,221,225,477 bytes");
    expect(tipFor("picture quality").textContent).toContain("grid 123");
  });
});

describe("SettingsScreen groups", () => {
  it("has the regrouped sections and Advanced holds the allow-list and offline map file", async () => {
    serve();
    const { container } = render(<SettingsScreen />);
    await screen.findByLabelText("On computers");
    const headings = Array.from(container.querySelectorAll(".admin-group__heading")).map((h) => h.textContent);
    expect(headings).toEqual(["Signing in", "Downloads", "Pictures", "Libraries", "Map and place names"]);
    const advanced = container.querySelector("details.admin-advanced") as HTMLElement;
    expect(within(advanced).getByLabelText("Offline map file")).toBeInTheDocument();
    expect(within(advanced).getByLabelText("Who can open the app")).toBeInTheDocument();
  });

  it("the Map and place names group keeps the #map-place-names anchor and scrolls to it", async () => {
    window.location.hash = "#map-place-names";
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    serve();
    render(<SettingsScreen />);
    const section = await screen.findByTestId("map-place-names");
    expect(section.id).toBe("map-place-names");
    expect(section).toHaveTextContent("This app works fully offline.");
    expect(section).toHaveTextContent("Nothing about your photos is sent.");
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    window.location.hash = "";
  });

  it("consent is off by default, gates the download, and saves instantly", async () => {
    const fetchMock = serve();
    render(<SettingsScreen />);
    const consent = await screen.findByRole("switch", { name: "Show maps and place names" });
    expect(consent).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("geonames-attribution")).toHaveTextContent("GeoNames");
    expect(screen.getByTestId("place-names-status")).toHaveTextContent("Not downloaded");
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
    fireEvent.click(consent);
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ osm_consent: true }]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Download" })).toBeEnabled());
  });

  it("downloads the place-name data on an explicit click and shows a readable size", async () => {
    let downloaded = false;
    const fetchMock = serve({ osm_consent: true }, (url, init) => {
      if (url === "/api/admin/place-names/download" && init?.method === "POST") {
        downloaded = true;
        return { ...PLACE_NAMES, downloaded: true, size_bytes: 2_097_152 };
      }
      if (url === "/api/admin/place-names") return { ...PLACE_NAMES, downloaded };
      return undefined;
    });
    render(<SettingsScreen />);
    await screen.findByRole("switch", { name: "Show maps and place names" });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/download"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(screen.getByTestId("place-names-status")).toHaveTextContent("Downloaded (2.1 MB)"));
  });

  it("saves the offline map file when the field is left, and an empty field clears it", async () => {
    const fetchMock = serve({ map_tiles_pmtiles_path: "/maps/world.pmtiles" });
    render(<SettingsScreen />);
    const field = await screen.findByLabelText("Offline map file");
    expect(field).toHaveValue("/maps/world.pmtiles");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ map_tiles_pmtiles_path: null }]));
  });

  it("Check Now posts once and says when a check is already running", async () => {
    let started = true;
    const fetchMock = serve({}, (url, init) =>
      url === "/api/admin/libraries/check-now" && init?.method === "POST" ? jsonResponse({ started }, 202) : undefined,
    );
    render(<SettingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Check Now" }));
    expect(await screen.findByText("Checking all libraries for changes now.")).toBeInTheDocument();
    started = false;
    fireEvent.click(screen.getByRole("button", { name: "Check Now" }));
    expect(await screen.findByText("A check is already running.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/libraries/check-now")).toHaveLength(2);
  });
});

describe("SettingsScreen allow-list", () => {
  it("loads the list and saves it when the box is left", async () => {
    const fetchMock = serve({}, (url, init) => {
      if (url === "/api/admin/settings/tailnet-allowlist" && init?.method === "PUT") return JSON.parse(String(init.body));
      if (url === "/api/admin/settings/tailnet-allowlist") return { identities: ["alice@example.ts.net"] };
      return undefined;
    });
    render(<SettingsScreen />);
    const box = await screen.findByDisplayValue("alice@example.ts.net");
    fireEvent.change(box, { target: { value: "alice@example.ts.net\nbob@example.ts.net\n" } });
    fireEvent.blur(box);
    await screen.findByText("Saved");
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ identities: ["alice@example.ts.net", "bob@example.ts.net"] });
  });

  it("shows the server's lock-out refusal and keeps what was typed", async () => {
    serve({}, (url, init) =>
      url === "/api/admin/settings/tailnet-allowlist" && init?.method === "PUT"
        ? jsonResponse({ detail: "allow-list must include your own tailnet identity, or you would be locked out" }, 400)
        : undefined,
    );
    render(<SettingsScreen />);
    const box = await screen.findByLabelText("Who can open the app");
    fireEvent.change(box, { target: { value: "someone-else@example.ts.net" } });
    fireEvent.blur(box);
    expect(await screen.findByText(/locked out/)).toBeInTheDocument();
    expect(box).toHaveValue("someone-else@example.ts.net");
  });
});
