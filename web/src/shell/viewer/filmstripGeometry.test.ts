import { describe, expect, it } from "vitest";
import {
  PITCH,
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
  it("sizes the current photo as 30 px x aspect, clamped 22-48, plus 5 px each side", () => {
    expect(currentWidth(photo(100, 100), 390)).toBe(30 + 10);
    expect(currentWidth(photo(400, 100), 390)).toBe(48 + 10);
    expect(currentWidth(photo(10, 100), 390)).toBe(22 + 10);
    expect(currentWidth(photo(0, 0), 390)).toBe(40);
  });

  it("sizes a video cell 90 + 6 px per second, capped at 55% of the strip", () => {
    const v = (duration: number | null) => ({ width: 1, height: 1, is_video: true, duration });
    expect(currentWidth(v(5), 390)).toBe(120);
    expect(currentWidth(v(null), 390)).toBe(90);
    expect(currentWidth(v(600), 390)).toBeCloseTo(0.55 * 390);
    expect(currentWidth(v(600), 100)).toBe(90);
  });

  it("centres the current item and packs slits 2 px apart either side", () => {
    const curW = 40;
    expect(restCell(5, 5, curW)).toEqual({ left: -20, width: 40 });
    const next = restCell(6, 5, curW);
    expect(next.left).toBe(20 + 2);
    expect(next.width).toBe(18);
    const prev = restCell(4, 5, curW);
    expect(prev.left + prev.width).toBe(-20 - 2);
    expect(restCell(7, 5, curW).left - (next.left + next.width)).toBe(2);
    expect(prev.left - (restCell(3, 5, curW).left + 18)).toBe(2);
  });

  it("puts the item at `pos` under the centre line while dragging", () => {
    const c = dragCell(10, 10);
    expect(c.left + c.width / 2).toBe(0);
    expect(dragCell(11, 10).left + 9).toBe(PITCH);
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
    const [wl, wh] = visibleRange(1000, 50000, 2400);
    expect(wh - wl).toBeGreaterThan(120);
  });

  it("converts a position inside the video cell to 0..1", () => {
    expect(videoFraction(30, 120)).toBe(0.25);
    expect(videoFraction(-5, 120)).toBe(0);
    expect(videoFraction(500, 120)).toBe(1);
  });
});
