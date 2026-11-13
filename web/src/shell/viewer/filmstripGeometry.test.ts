import { describe, expect, it } from "vitest";
import {
  CURRENT_GAP,
  PITCH,
  SLIT_WIDTH,
  STRIP_HEIGHT,
  clampPos,
  currentWidth,
  dragCell,
  indexAtPos,
  posFromDrag,
  restCell,
  videoFraction,
  visibleRange,
} from "./filmstripGeometry";

const photo = (width: number, height: number) => ({ width, height, is_video: false, duration: null });

describe("filmstrip geometry (#221)", () => {
  it("sizes the current photo as 44 px x aspect, clamped 34-88", () => {
    expect(currentWidth(photo(4, 3), 390)).toBeCloseTo((44 * 4) / 3);
    expect(currentWidth(photo(400, 100), 390)).toBe(88);
    expect(currentWidth(photo(10, 100), 390)).toBe(34);
    expect(currentWidth(photo(0, 0), 390)).toBe(44);
    // Neighbours are close to square (3:4 to 1:1).
    expect(SLIT_WIDTH / STRIP_HEIGHT).toBeGreaterThanOrEqual(0.75);
    expect(SLIT_WIDTH / STRIP_HEIGHT).toBeLessThanOrEqual(1);
  });

  it("sizes a video cell 90 + 6 px per second, capped at 55% of the strip", () => {
    const v = (duration: number | null) => ({ width: 1, height: 1, is_video: true, duration });
    expect(currentWidth(v(5), 390)).toBe(120);
    expect(currentWidth(v(null), 390)).toBe(90);
    expect(currentWidth(v(600), 390)).toBeCloseTo(0.55 * 390);
    expect(currentWidth(v(600), 100)).toBe(90);
  });

  it("centres the current item and packs slits 2 px apart either side", () => {
    const curW = 60;
    expect(restCell(5, 5, curW)).toEqual({ left: -30, width: 60 });
    const next = restCell(6, 5, curW);
    expect(next.left).toBe(30 + CURRENT_GAP);
    expect(next.width).toBe(SLIT_WIDTH);
    const prev = restCell(4, 5, curW);
    expect(prev.left + prev.width).toBe(-30 - CURRENT_GAP);
    expect(restCell(7, 5, curW).left - (next.left + next.width)).toBe(2);
    expect(prev.left - (restCell(3, 5, curW).left + SLIT_WIDTH)).toBe(2);
  });

  it("puts the item at `pos` under the centre line while dragging", () => {
    const c = dragCell(10, 10);
    expect(c.left + c.width / 2).toBe(0);
    expect(dragCell(11, 10).left + SLIT_WIDTH / 2).toBe(PITCH);
  });

  it("maps drag distance to a fractional index, clamped to the list", () => {
    expect(posFromDrag(100, -PITCH * 3, 1000)).toBe(103);
    expect(posFromDrag(100, PITCH * 3, 1000)).toBe(97);
    expect(posFromDrag(2, PITCH * 50, 1000)).toBe(0);
    expect(posFromDrag(998, -PITCH * 50, 1000)).toBe(999);
    expect(clampPos(5, 0)).toBe(0);
    expect(indexAtPos(3.6, 10)).toBe(4);
    expect(indexAtPos(99, 10)).toBe(9);
  });

  it("mounts a bounded window of the full list, anywhere in 50k items", () => {
    const [lo, hi] = visibleRange(25000, 50000, 390);
    expect(hi - lo + 1).toBe(81);
    expect(visibleRange(0, 50000, 390)).toEqual([0, 40]);
    expect(visibleRange(49999, 50000, 390)[1]).toBe(49999);
    expect(visibleRange(0, 0, 390)).toEqual([0, -1]);
    const [wl, wh] = visibleRange(1000, 50000, 6000);
    expect(wh - wl).toBeGreaterThan(120);
  });

  it("converts a position inside the video cell to 0..1", () => {
    expect(videoFraction(30, 120)).toBe(0.25);
    expect(videoFraction(-5, 120)).toBe(0);
    expect(videoFraction(500, 120)).toBe(1);
  });
});
