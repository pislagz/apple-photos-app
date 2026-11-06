import { describe, expect, it } from "vitest";
import { cellHeight, computeCellSize, GRID_GAP, gridRowHeight } from "./gridMetrics";

describe("gridMetrics", () => {
  it("cells plus gaps exactly fill the container width", () => {
    for (const columns of [2, 3, 4, 6, 8, 10]) {
      const size = computeCellSize(1000, columns);
      expect(size * columns + (columns - 1) * GRID_GAP).toBeCloseTo(1000);
    }
  });

  it("returns 0 for unmeasured width or bad columns", () => {
    expect(computeCellSize(0, 6)).toBe(0);
    expect(computeCellSize(500, 0)).toBe(0);
  });

  it("rows add one trailing gap so vertical spacing matches horizontal", () => {
    const size = computeCellSize(1000, 6);
    expect(gridRowHeight(size, false)).toBe(size + GRID_GAP);
  });

  it("feature rows span two cells plus the gap between them", () => {
    expect(cellHeight(100, true)).toBe(100 * 2 + GRID_GAP);
    expect(gridRowHeight(100, true)).toBe(100 * 2 + GRID_GAP * 2);
  });
});
