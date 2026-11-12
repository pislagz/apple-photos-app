import { describe, expect, it } from "vitest";
import {
  columnsForEdge,
  columnWidths,
  computeCellSize,
  DEFAULT_ZOOM_INDEX,
  gapForEdge,
  squareEdge,
  thumbSizeFor,
  ZOOM_EDGES,
  FEATURE_ASPECT,
  FEATURE_COLUMNS,
  FEATURE_MAX_WIDTH,
  featureHeight,
  featureRowHeight,
  featureWidth,
  GRID_GAP,
  gridRowHeight,
} from "./gridMetrics";

describe("edge-length zoom (#207)", () => {
  it("has five stops with 150 px as the default", () => {
    expect([...ZOOM_EDGES]).toEqual([72, 104, 150, 210, 300]);
    expect(ZOOM_EDGES[DEFAULT_ZOOM_INDEX]).toBe(150);
  });

  it("uses a 2 px gap, 1 px at the smallest edge", () => {
    expect(gapForEdge(72)).toBe(1);
    for (const edge of [104, 150, 210, 300]) expect(gapForEdge(edge)).toBe(2);
  });

  it("fills the width flush right with no gutter at 1024, 1280, 1440 and 1920", () => {
    for (const width of [1024, 1280, 1440, 1920]) {
      for (const edge of ZOOM_EDGES) {
        for (const dpr of [1, 2]) {
          const gap = gapForEdge(edge);
          const columns = columnsForEdge(width, edge, gap);
          const widths = columnWidths(width, columns, gap, dpr);
          expect(widths).toHaveLength(columns);
          const total = widths.reduce((a, b) => a + b, 0) + (columns - 1) * gap;
          expect(total).toBeCloseTo(width, 6);
          // Tile edges sit on whole device pixels and stay within a device pixel of the target.
          for (const w of widths) {
            expect(Math.abs(w * dpr - Math.round(w * dpr))).toBeLessThan(1e-6);
            expect(w).toBeGreaterThanOrEqual(edge - gap - 1 / dpr);
            expect(w).toBeLessThan(edge + gap + 1 + 1 / dpr + edge / columns);
          }
          expect(squareEdge(width, columns, gap, dpr)).toBeLessThanOrEqual(Math.max(...widths));
        }
      }
    }
  });

  it("gives about nine columns at 150 px in a 1440 window minus the sidebar", () => {
    expect(columnsForEdge(1220, 150)).toBe(8);
    expect(columnsForEdge(1440, 150)).toBe(9);
    expect(columnsForEdge(1024, 72)).toBe(14);
    expect(columnsForEdge(1920, 300)).toBe(6);
  });

  it("never returns zero columns", () => {
    expect(columnsForEdge(100, 300)).toBe(1);
    expect(columnsForEdge(0, 150)).toBeGreaterThan(0);
  });

  it("asks for the small thumb up to 150 px and the 2x thumb above, or on dense screens", () => {
    expect(thumbSizeFor(72)).toBe("grid");
    expect(thumbSizeFor(150, 2)).toBe("grid");
    expect(thumbSizeFor(150, 3)).toBe("grid2x");
    expect(thumbSizeFor(210)).toBe("grid2x");
    expect(thumbSizeFor(300, 2)).toBe("grid2x");
  });
});

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

  it("from 1600px the cap blends in and grows with the thumbnail size, keeping 2:1", () => {
    // A 3440 wide window (well past the blend), 6 columns.
    const cell = computeCellSize(3200, 6);
    const expected = FEATURE_COLUMNS * cell + (FEATURE_COLUMNS - 1) * GRID_GAP;
    expect(featureWidth(3200, cell)).toBeCloseTo(expected);
    expect(featureWidth(3200, cell)).toBeGreaterThan(FEATURE_MAX_WIDTH);
    expect(featureHeight(3200, cell)).toBe(Math.round(featureWidth(3200, cell) / FEATURE_ASPECT));
    // Small thumbnails never shrink it below the 960 cap.
    expect(featureWidth(1920, computeCellSize(1920, 10))).toBe(FEATURE_MAX_WIDTH);
    // Large thumbnails never exceed the content width.
    expect(featureWidth(2200, computeCellSize(2200, 2))).toBe(2200);
    expect(featureWidth(1700, computeCellSize(1700, 2))).toBeLessThanOrEqual(1700);
  });

  it("the Days lead photo has no step at any width (#177)", () => {
    // The container itself grows 1 px per px; the blend adds a little on top
    // (at most ~4 px per px, with 2 columns). The old hard switch jumped
    // ~100 px at 1600 with 6 columns.
    const MAX_STEP = 5;
    for (const columns of [2, 3, 4, 5, 6, 8, 10, 14]) {
      let previous = featureWidth(900, computeCellSize(900, columns));
      for (let width = 901; width <= 2600; width++) {
        const lead = featureWidth(width, computeCellSize(width, columns));
        expect(lead).toBeGreaterThanOrEqual(previous);
        expect(lead - previous).toBeLessThanOrEqual(MAX_STEP);
        expect(lead).toBeLessThanOrEqual(width);
        previous = lead;
      }
    }
  });
});
