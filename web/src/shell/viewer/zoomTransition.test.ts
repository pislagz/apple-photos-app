import { describe, expect, it } from "vitest";
import { dragFrame, frameClip, frameTransform, intersectsWindow, tileFrame } from "./zoomTransition";

const stage = { left: 0, top: 0, width: 390, height: 700 };

describe("tileFrame", () => {
  it("covers a square tile with a landscape photo and crops the sides", () => {
    // Fit 390x260; tile 100x100 at (20, 40): scale = 100/260.
    const frame = tileFrame(stage, { w: 390, h: 260 }, { left: 20, top: 40, width: 100, height: 100 });
    expect(frame).not.toBeNull();
    const scale = 100 / 260;
    expect(frame!.scale).toBeCloseTo(scale);
    // Stage centre (195, 350) -> tile centre (70, 90).
    expect(frame!.dx).toBeCloseTo(-125);
    expect(frame!.dy).toBeCloseTo(-260);
    // The kept window is the tile seen through the scale: 100/scale = 260 px
    // wide and tall, centred on the stage.
    expect(frame!.clip.left).toBeCloseTo((390 - 260) / 2);
    expect(frame!.clip.right).toBeCloseTo((390 - 260) / 2);
    expect(frame!.clip.top).toBeCloseTo((700 - 260) / 2);
    expect(frame!.clip.bottom).toBeCloseTo((700 - 260) / 2);
  });

  it("covers a square tile with a portrait photo", () => {
    const frame = tileFrame(stage, { w: 300, h: 600 }, { left: 0, top: 0, width: 100, height: 100 })!;
    expect(frame.scale).toBeCloseTo(100 / 300);
  });

  it("lands exactly on the tile: the scaled fit contains the tile", () => {
    const fit = { w: 390, h: 520 };
    const tile = { left: 200, top: 300, width: 120, height: 120 };
    const frame = tileFrame(stage, fit, tile)!;
    expect(fit.w * frame.scale).toBeGreaterThanOrEqual(tile.width - 1e-9);
    expect(fit.h * frame.scale).toBeGreaterThanOrEqual(tile.height - 1e-9);
  });

  it("is null without a usable size so the caller fades", () => {
    expect(tileFrame(stage, { w: 0, h: 0 }, { left: 0, top: 0, width: 10, height: 10 })).toBeNull();
    expect(tileFrame(stage, { w: 100, h: 100 }, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
    expect(tileFrame({ ...stage, width: 0 }, { w: 100, h: 100 }, { left: 0, top: 0, width: 10, height: 10 })).toBeNull();
  });

  it("formats CSS", () => {
    const frame = tileFrame(stage, { w: 390, h: 260 }, { left: 20, top: 40, width: 100, height: 100 })!;
    expect(frameTransform(frame)).toMatch(/^translate\(-125px, -260px\) scale\(0\.38/);
    expect(frameClip(frame)).toMatch(/^inset\(220px 65px 220px 65px\)$/);
  });
});

describe("dragFrame", () => {
  it("carries the finger offset and shrink without a crop", () => {
    const frame = dragFrame({ x: 12, y: 150 }, 0.9);
    expect(frameTransform(frame)).toBe("translate(12px, 150px) scale(0.9)");
    expect(frameClip(frame)).toBe("inset(0px 0px 0px 0px)");
  });
});

describe("intersectsWindow", () => {
  const win = { w: 390, h: 800 };
  it("accepts visible and partly visible tiles", () => {
    expect(intersectsWindow({ left: 10, top: 10, width: 90, height: 90 }, win)).toBe(true);
    expect(intersectsWindow({ left: 350, top: 780, width: 90, height: 90 }, win)).toBe(true);
  });
  it("rejects tiles outside the window or without size", () => {
    expect(intersectsWindow({ left: 0, top: 900, width: 90, height: 90 }, win)).toBe(false);
    expect(intersectsWindow({ left: 0, top: -200, width: 90, height: 90 }, win)).toBe(false);
    expect(intersectsWindow({ left: 0, top: 0, width: 0, height: 0 }, win)).toBe(false);
  });
});
