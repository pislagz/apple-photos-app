import { describe, expect, it } from "vitest";
import { darkPaint, darkTileTemplate, darkVariant, recolor, recolorPixels } from "./darkMap";

const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe("darkVariant", () => {
  it("reads ?mapdark and defaults to the tuned combination", () => {
    expect(darkVariant("?mapdark=1")).toBe(1);
    expect(darkVariant("?mapdark=2")).toBe(2);
    expect(darkVariant("")).toBe(3);
    expect(darkVariant("?mapdark=9")).toBe(3);
  });
  it("only the recolouring variants use the protocol, on the same OSM path", () => {
    expect(darkTileTemplate(1)).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(darkTileTemplate(2)).toBe("osmdark://osm/{z}/{x}/{y}.png");
  });
  it("variant 1 swaps brightness to invert", () => {
    const p = darkPaint(1) as Record<string, number>;
    expect(p["raster-brightness-min"]).toBeGreaterThan(p["raster-brightness-max"]);
  });
});

describe("recolor", () => {
  it("makes OSM land dark green, water dark blue, parks green, roads lighter than land", () => {
    const land = recolor(0xf2, 0xef, 0xe9);
    const water = recolor(0xaa, 0xd3, 0xdf);
    const park = recolor(0xcd, 0xeb, 0xb0);
    const road = recolor(255, 255, 255);
    expect(lum(land)).toBeLessThan(50);
    expect(land[1]).toBeGreaterThan(land[0]);
    expect(water[2]).toBeGreaterThan(water[0]);
    expect(park[1]).toBeGreaterThan(park[0]);
    expect(lum(road)).toBeGreaterThan(lum(land));
  });
  it("turns dark label text light", () => {
    expect(lum(recolor(30, 30, 30))).toBeGreaterThan(180);
  });
  it("recolours pixels in place and keeps alpha", () => {
    const data = new Uint8ClampedArray([242, 239, 233, 200, 0, 0, 0, 255]);
    recolorPixels(data);
    expect(data[3]).toBe(200);
    expect(data[0]).toBeLessThan(60);
    expect(data[4]).toBeGreaterThan(180);
  });
});
