import { describe, expect, it } from "vitest";
import { clampOffset, clampZoom, cropFractions, displaySize } from "./avatarCrop";

describe("avatar crop geometry (#256)", () => {
  const natural = { w: 400, h: 200 };

  it("covers the circle at zoom 1 and magnifies with zoom", () => {
    expect(displaySize(natural, 100, 1)).toEqual({ w: 200, h: 100 });
    expect(displaySize(natural, 100, 2)).toEqual({ w: 400, h: 200 });
  });

  it("never lets the circle leave the photo", () => {
    const size = displaySize(natural, 100, 1);
    expect(clampOffset({ x: 999, y: 999 }, size, 100)).toEqual({ x: 50, y: 0 });
    expect(clampOffset({ x: -999, y: -5 }, size, 100)).toEqual({ x: -50, y: 0 });
  });

  it("clamps zoom", () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(99)).toBe(4);
  });

  it("centred crop is the middle square of the photo", () => {
    const crop = cropFractions(displaySize(natural, 100, 1), { x: 0, y: 0 }, 100);
    expect(crop).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 });
  });

  it("dragging the photo right shows its left part", () => {
    const size = displaySize(natural, 100, 1);
    const crop = cropFractions(size, { x: 50, y: 0 }, 100);
    expect(crop.x).toBe(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1);
  });

  it("zooming in shrinks the framed area", () => {
    const crop = cropFractions(displaySize(natural, 100, 2), { x: 0, y: 0 }, 100);
    expect(crop.width).toBe(0.25);
    expect(crop.height).toBe(0.5);
  });
});
