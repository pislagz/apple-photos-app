import { describe, expect, it } from "vitest";
import {
  computeCellSize,
  FEATURE_ASPECT,
  FEATURE_MAX_WIDTH,
  featureHeight,
  featureRowHeight,
  featureWidth,
  GRID_GAP,
  gridRowHeight,
} from "./gridMetrics";

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
    expect(gridRowHeight(size)).toBe(size + GRID_GAP);
  });

  it("Days lead photo is capped in width and keeps a 2:1 aspect (#153)", () => {
    for (const width of [1200, 1920, 2560]) {
      expect(featureWidth(width)).toBe(FEATURE_MAX_WIDTH);
      expect(featureHeight(width)).toBe(FEATURE_MAX_WIDTH / FEATURE_ASPECT);
    }
    expect(featureWidth(700)).toBe(700);
    expect(featureHeight(700)).toBe(350);
    expect(featureWidth(0)).toBe(0);
    expect(featureRowHeight(1920)).toBe(featureHeight(1920) + GRID_GAP);
  });
});
