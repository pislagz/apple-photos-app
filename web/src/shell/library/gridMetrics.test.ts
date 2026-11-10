import { describe, expect, it } from "vitest";
import {
  computeCellSize,
  FEATURE_ASPECT,
  FEATURE_COLUMNS,
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

  it("Days lead photo below 960px keeps the original two-rows-tall, full-width rule", () => {
    for (const width of [320, 700, 959]) {
      const cell = computeCellSize(width, 6);
      expect(featureWidth(width, cell)).toBe(width);
      expect(featureHeight(width, cell)).toBe(Math.round(cell * 2 + GRID_GAP));
    }
    // Two rows tall, so the ratio follows the column count (5 columns: ~2.5:1).
    const five = computeCellSize(900, 5);
    expect(900 / featureHeight(900, five)).toBeCloseTo(2.5, 1);
    expect(featureWidth(0)).toBe(0);
  });

  it("Days lead photo from 960px is capped in width at a fixed 2:1 aspect (#153)", () => {
    for (const width of [960, 1200, 1599]) {
      const cell = computeCellSize(width, 6);
      expect(featureWidth(width, cell)).toBe(FEATURE_MAX_WIDTH);
      expect(featureHeight(width, cell)).toBe(FEATURE_MAX_WIDTH / FEATURE_ASPECT);
    }
    // Even a huge cell size changes nothing below 1600px.
    expect(featureWidth(1599, 1000)).toBe(FEATURE_MAX_WIDTH);
    expect(featureRowHeight(1200, 200)).toBe(featureHeight(1200, 200) + GRID_GAP);
  });

  it("from 1600px the cap grows with the thumbnail size, keeping 2:1", () => {
    // 2560 wide window, ~2300px of content, 6 columns: ~388px cells.
    const cell = computeCellSize(2300, 6);
    const expected = FEATURE_COLUMNS * cell + (FEATURE_COLUMNS - 1) * GRID_GAP;
    expect(featureWidth(2300, cell)).toBeCloseTo(expected);
    expect(featureWidth(2300, cell)).toBeGreaterThan(FEATURE_MAX_WIDTH);
    expect(featureHeight(2300, cell)).toBe(Math.round(featureWidth(2300, cell) / FEATURE_ASPECT));
    // Small thumbnails never shrink it below the 960 cap.
    expect(featureWidth(1920, computeCellSize(1920, 10))).toBe(FEATURE_MAX_WIDTH);
    // Large thumbnails never exceed the content width.
    expect(featureWidth(1700, computeCellSize(1700, 2))).toBe(1700);
  });
});
