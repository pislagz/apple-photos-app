import { describe, expect, it } from "vitest";
import { DARK_PAINT } from "./darkMap";
import { OSM_TILE_TEMPLATE, osmStyle } from "./basemap";

describe("dark basemap", () => {
  it("inverts brightness by swapping min and max", () => {
    const p = DARK_PAINT as Record<string, number>;
    expect(p["raster-brightness-min"]).toBeGreaterThan(p["raster-brightness-max"]);
  });
  it("uses the same OSM tile URL in light and dark, with paint only in dark", () => {
    const light = osmStyle(false);
    const dark = osmStyle(true);
    expect((light.sources.osm as { tiles: string[] }).tiles).toEqual([OSM_TILE_TEMPLATE]);
    expect((dark.sources.osm as { tiles: string[] }).tiles).toEqual([OSM_TILE_TEMPLATE]);
    const osm = (s: typeof light) => s.layers.find((l) => l.id === "osm") as { paint?: object };
    expect(osm(light).paint).toEqual({});
    expect(osm(dark).paint).toEqual(DARK_PAINT);
  });
});
