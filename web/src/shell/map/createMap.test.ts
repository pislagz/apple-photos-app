import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapConfig } from "../../api";

// MapLibre needs WebGL, so a recorder stands in. What matters here is which
// basemap each configuration starts with, and when the archive takes over.
const maps: { style: { sources: Record<string, unknown> }; setStyle: ReturnType<typeof vi.fn>; fail: () => void }[] = [];

vi.mock("maplibre-gl", () => {
  class Map {
    style: { sources: Record<string, unknown> };
    setStyle = vi.fn();
    handlers: Record<string, ((event: unknown) => void)[]> = {};
    constructor(options: { style: { sources: Record<string, unknown> } }) {
      this.style = options.style;
      maps.push({ style: this.style, setStyle: this.setStyle, fail: () => this.handlers.error?.forEach((h) => h({ sourceId: "osm" })) });
    }
    on(name: string, handler: (event: unknown) => void) {
      (this.handlers[name] ??= []).push(handler);
    }
  }
  return { Map, setWorkerUrl: vi.fn(), addProtocol: vi.fn() };
});
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?url", () => ({ default: "/worker.mjs" }));
vi.mock("pmtiles", () => {
  class PMTiles {
    async getHeader() {
      return { tileType: 1 };
    }
  }
  class Protocol {
    tile = vi.fn();
    add = vi.fn();
  }
  return { PMTiles, Protocol, TileType: { Mvt: 1 } };
});

import { createMap } from "./createMap";

const container = document.createElement("div");
const config = (value: Partial<MapConfig>): MapConfig => ({ mode: "off", pmtiles_url: null, ...value });

beforeEach(() => {
  maps.length = 0;
});

describe("createMap basemap choice", () => {
  it("with consent uses OpenStreetMap tiles even when an archive is configured", async () => {
    await createMap(container, config({ mode: "online", pmtiles_url: "/api/map/tiles.pmtiles" }));
    expect(Object.keys(maps[0].style.sources)).toEqual(["osm"]);
  });

  it("falls back to the archive once, when the OSM tiles fail", async () => {
    await createMap(container, config({ mode: "online", pmtiles_url: "/api/map/tiles.pmtiles" }));
    maps[0].fail();
    maps[0].fail();
    await vi.waitFor(() => expect(maps[0].setStyle).toHaveBeenCalledTimes(1));
    expect(Object.keys((maps[0].setStyle.mock.calls[0][0] as { sources: object }).sources)).toEqual(["pm"]);
  });

  it("with consent and no archive keeps OSM and has nothing to fall back to", async () => {
    await createMap(container, config({ mode: "online" }));
    maps[0].fail();
    await Promise.resolve();
    expect(maps[0].setStyle).not.toHaveBeenCalled();
  });

  it("without consent reads the archive and never uses OSM", async () => {
    await createMap(container, config({ mode: "local_file", pmtiles_url: "/api/map/tiles.pmtiles" }));
    expect(Object.keys(maps[0].style.sources)).toEqual(["pm"]);
  });

  it("is blank when off", async () => {
    await createMap(container, config({}));
    expect(maps[0].style.sources).toEqual({});
  });
});

describe("createMap theme switch", () => {
  // A controllable prefers-color-scheme query.
  function mockScheme(initial: boolean) {
    const listeners: (() => void)[] = [];
    const query = {
      matches: initial,
      addEventListener: (_: string, h: () => void) => listeners.push(h),
      removeEventListener: (_: string, h: () => void) => listeners.splice(listeners.indexOf(h), 1),
    };
    vi.stubGlobal("matchMedia", () => query);
    window.matchMedia = (() => query) as unknown as typeof window.matchMedia;
    return (dark: boolean) => {
      query.matches = dark;
      [...listeners].forEach((h) => h());
    };
  }
  const paintOf = (style: unknown) =>
    (style as { layers: { id: string; paint: Record<string, unknown> }[] }).layers.find((l) => l.id === "osm")!.paint;

  it("restyles an open map when the theme flips, without recreating it", async () => {
    const flip = mockScheme(false);
    await createMap(container, config({ mode: "online" }));
    expect(paintOf(maps[0].style)).toEqual({});
    flip(true);
    expect(maps[0].setStyle).toHaveBeenCalledTimes(1);
    expect(paintOf(maps[0].setStyle.mock.calls[0][0])["raster-brightness-max"]).toBe(0.1);
    flip(false);
    expect(maps[0].setStyle).toHaveBeenCalledTimes(2);
    expect(paintOf(maps[0].setStyle.mock.calls[1][0])).toEqual({});
    expect(maps).toHaveLength(1);
  });

  it("starts dark when the system is dark", async () => {
    mockScheme(true);
    await createMap(container, config({ mode: "online" }));
    expect(paintOf(maps[0].style)["raster-hue-rotate"]).toBe(180);
  });
});
