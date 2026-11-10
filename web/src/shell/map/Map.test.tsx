import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapCluster, MapConfig, MeResponse } from "../../api";
import { findThumb, jsonResponse, mockFetch } from "../../testHelpers";
import { useFakeLayout } from "../../testLayout";
import DesktopShell from "../DesktopShell";
import MobileShell from "../MobileShell";
import { clampBox } from "./MapView";
import MiniMap from "./MiniMap";

// jsdom has no WebGL, so MapLibre itself is replaced by a recorder. What is
// under test is when the map is created and removed (that is when the browser
// would request tiles), the config it gets, the attribution, and what a pin does.
const created: { config: MapConfig; removed: boolean; fitBounds: ReturnType<typeof vi.fn>; zoom: number }[] = [];
const markers: { element: HTMLElement }[] = [];

vi.mock("./createMap", () => ({
  createMap: vi.fn(async (_el: HTMLElement, config: MapConfig) => {
    const record = { config, removed: false, fitBounds: vi.fn(), zoom: 3 };
    created.push(record);
    const map = {
      on: vi.fn(),
      getZoom: () => record.zoom,
      getBounds: () => ({ getWest: () => -10, getEast: () => 10, getSouth: () => -10, getNorth: () => 10 }),
      fitBounds: record.fitBounds,
      remove: () => {
        record.removed = true;
      },
    };
    class Marker {
      element: HTMLElement;
      constructor(options: { element: HTMLElement }) {
        this.element = options.element;
        markers.push(this);
      }
      setLngLat() {
        return this;
      }
      addTo() {
        return this;
      }
      remove() {}
    }
    return { map, maplibregl: { Marker } };
  }),
}));

useFakeLayout();

const ME: MeResponse = {
  username: "alice",
  role: "user",
  libraries: [{ id: 1, display_name: "Family" }],
  layout_override: null,
};

const PARIS: MapCluster = {
  lat: 48.85,
  lon: 2.35,
  count: 3,
  cover_id: "c1",
  bounds: { west: 2.3, south: 48.8, east: 2.4, north: 48.9 },
};
const LONE: MapCluster = {
  lat: 10,
  lon: 20,
  count: 1,
  cover_id: "c2",
  bounds: { west: 20, south: 10, east: 20, north: 10 },
};
const ITEM = {
  id: "p1",
  filename: "p1.jpg",
  date: "2024-01-01T00:00:00",
  is_video: false,
  is_live_photo: false,
  favorite: false,
  width: 10,
  height: 10,
  duration: null,
};

function handler(requested: string[], config: () => Response | MapConfig = () => ({ mode: "online", pmtiles_url: null })) {
  return (url: string) => {
    requested.push(url);
    if (url === "/api/map/config") return config();
    if (url.startsWith("/api/libraries/1/map")) {
      return { clusters: [PARIS, LONE], total: 4 };
    }
    if (url === "/api/libraries/1/albums") return { tree: [], smart: [] };
    if (url.startsWith("/api/libraries/1/assets")) return { items: [ITEM], next_cursor: null };
    if (url === "/api/libraries/1/summary") return { years: [], months: [], days: [] };
    throw new Error(`unexpected request: ${url}`);
  };
}

beforeEach(() => {
  created.length = 0;
  markers.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

function renderDesktop() {
  render(
    <DesktopShell
      me={ME}
      activeLibraryId={1}
      onActiveLibraryChange={() => {}}
      layoutOverride="auto"
      onLayoutOverrideChange={() => {}}
      onLogout={() => {}}
    />,
  );
}

function renderMobile() {
  render(
    <MobileShell
      me={ME}
      activeLibraryId={1}
      onActiveLibraryChange={() => {}}
      layoutOverride="auto"
      onLayoutOverrideChange={() => {}}
      onLogout={() => {}}
    />,
  );
}

describe("desktop Map", () => {
  it("creates no map (so requests no tiles) until Map opens, and removes it on leaving", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested));
    renderDesktop();
    await screen.findByRole("button", { name: "Library" });
    expect(created).toHaveLength(0);
    expect(requested.includes("/api/map/config")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].config.mode).toBe("online");

    const link = await screen.findByRole("link", { name: "© OpenStreetMap contributors" });
    expect(link).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");

    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    await waitFor(() => expect(created[0].removed).toBe(true));
    expect(screen.queryByRole("link", { name: /OpenStreetMap/ })).not.toBeInTheDocument();
  });

  it("draws pins from the clusters; a lone pin opens its photos, a cluster zooms in", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested));
    renderDesktop();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(markers.length).toBeGreaterThan(0));

    const cluster = markers.find((m) => m.element.getAttribute("aria-label") === "3 photos") as { element: HTMLElement };
    expect(cluster.element.querySelector("img")?.getAttribute("src")).toBe("/api/libraries/1/thumb/c1?size=grid");
    fireEvent.click(cluster.element);
    // (the first fit, to all located photos, came before the click)
    expect(created[0].fitBounds).toHaveBeenLastCalledWith(
      [
        [2.3, 48.8],
        [2.4, 48.9],
      ],
      expect.anything(),
    );

    const lone = markers.find((m) => m.element.getAttribute("aria-label") === "1 photo") as { element: HTMLElement };
    fireEvent.click(lone.element);
    expect(await screen.findByRole("heading", { name: "Photos here" })).toBeInTheDocument();
    await waitFor(() => expect(requested.some((u) => u.includes("place=20%2C10%2C20%2C10"))).toBe(true));
    expect(await findThumb("p1")).toBeInTheDocument();

    // Back returns to the map.
    fireEvent.click(screen.getAllByRole("button", { name: "Map" }).at(-1) as HTMLElement);
    await waitFor(() => expect(created).toHaveLength(2));
  });

  it("Off mode: map without the OSM attribution", async () => {
    mockFetch(handler([], () => ({ mode: "off", pmtiles_url: null })));
    renderDesktop();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].config.mode).toBe("off");
    expect(screen.queryByRole("link", { name: /OpenStreetMap/ })).not.toBeInTheDocument();
    // D41: the view says the map is off and how to enable it.
    expect(screen.getByTestId("map-off-note")).toHaveTextContent(/Map & place names/);
  });

  it("Online mode shows no off-note (D41)", async () => {
    mockFetch(handler([]));
    renderDesktop();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(screen.queryByTestId("map-off-note")).toBeNull();
  });

  it("says the map settings failed to load and retries", async () => {
    let fail = true;
    mockFetch(handler([], () => (fail ? jsonResponse({ detail: "x" }, 500) : { mode: "online", pmtiles_url: null })));
    renderDesktop();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(await screen.findByText(/Couldn't load the map settings/)).toBeInTheDocument();
    expect(created).toHaveLength(0);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(created).toHaveLength(1));
  });

  it("says so when cluster loading fails, and retries", async () => {
    let fail = true;
    mockFetch((url) => {
      if (url === "/api/map/config") return { mode: "online", pmtiles_url: null };
      if (url.startsWith("/api/libraries/1/map")) {
        return fail ? jsonResponse({ detail: "x" }, 500) : { clusters: [PARIS], total: 3 };
      }
      if (url === "/api/libraries/1/albums") return { tree: [], smart: [] };
      throw new Error(`unexpected request: ${url}`);
    });
    renderDesktop();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    // A small banner, not the full overlay, and the map is not rebuilt.
    expect(await screen.findByText(/Couldn't load photos for this area/)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load the map\./)).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(markers.length).toBeGreaterThan(0));
    expect(created).toHaveLength(1);
    expect(created[0].removed).toBe(false);
    expect(screen.queryByText(/Couldn't load photos for this area/)).not.toBeInTheDocument();
  });

  it("clampBox keeps the viewport inside the API's valid ranges", () => {
    expect(clampBox(-180.0001, -90.5, 179.9, 91)).toEqual({ west: -180, south: -90, east: 179.9, north: 90 });
    expect(clampBox(-200, 0, 200, 10)).toBeNull();
    expect(clampBox(2, 3, 4, 5)).toEqual({ west: 2, south: 3, east: 4, north: 5 });
  });
});

describe("phone Places", () => {
  it("/places is the map and a deep link reload works", async () => {
    window.history.replaceState({}, "", "/places");
    mockFetch(handler([]));
    renderMobile();
    expect(await screen.findByRole("heading", { name: "Places" })).toBeInTheDocument();
    await waitFor(() => expect(created).toHaveLength(1));
    expect(await screen.findByRole("link", { name: "© OpenStreetMap contributors" })).toBeInTheDocument();
  });

  it("a pin opens /places/<bbox> with that box's photos; Back returns to the map", async () => {
    window.history.replaceState({}, "", "/places");
    const requested: string[] = [];
    mockFetch(handler(requested));
    renderMobile();
    await waitFor(() => expect(markers.length).toBeGreaterThan(0));
    const lone = markers.find((m) => m.element.getAttribute("aria-label") === "1 photo") as { element: HTMLElement };
    fireEvent.click(lone.element);
    await waitFor(() => expect(window.location.pathname).toBe("/places/20%2C10%2C20%2C10"));
    await waitFor(() => expect(requested.some((u) => u.includes("place=20%2C10%2C20%2C10"))).toBe(true));
    expect(requested.some((u) => u.includes("album="))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Places" }));
    await waitFor(() => expect(window.location.pathname).toBe("/places"));
  });
});

describe("Info panel mini-map", () => {
  it("uses the same setting, shows the attribution, and removes the map on unmount", async () => {
    mockFetch(handler([]));
    const { unmount } = render(<MiniMap latitude={1} longitude={2} />);
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].config.mode).toBe("online");
    expect(await screen.findByRole("link", { name: "© OpenStreetMap contributors" })).toBeInTheDocument();
    unmount();
    await waitFor(() => expect(created[0].removed).toBe(true));
  });

  it("Off mode: no attribution", async () => {
    mockFetch(handler([], () => ({ mode: "off", pmtiles_url: null })));
    render(<MiniMap latitude={1} longitude={2} />);
    await waitFor(() => expect(created).toHaveLength(1));
    expect(screen.queryByRole("link", { name: /OpenStreetMap/ })).not.toBeInTheDocument();
  });
});
