import { describe, expect, it } from "vitest";
import { autoScrollStep, isHorizontalStart, rangeSelection } from "./swipeSelect";

const order = ["a", "b", "c", "d", "e", "f"];

describe("rangeSelection (#222)", () => {
  it("selects the run between start and current, in either direction", () => {
    expect([...rangeSelection(order, 1, 3, new Set(), "select")]).toEqual(["b", "c", "d"]);
    expect([...rangeSelection(order, 3, 1, new Set(), "select")].sort()).toEqual(["b", "c", "d"]);
  });
  it("keeps the earlier selection and shrinks live when the finger returns", () => {
    const base = new Set(["a"]);
    expect([...rangeSelection(order, 2, 4, base, "select")].sort()).toEqual(["a", "c", "d", "e"]);
    expect([...rangeSelection(order, 2, 2, base, "select")].sort()).toEqual(["a", "c"]);
  });
  it("deselects a run when the first tile was selected", () => {
    const base = new Set(order);
    expect([...rangeSelection(order, 1, 2, base, "deselect")].sort()).toEqual(["a", "d", "e", "f"]);
  });
});

describe("autoScrollStep", () => {
  it("is 0 in the middle and scales with depth to 14 px", () => {
    expect(autoScrollStep(300, 100, 700)).toBe(0);
    expect(autoScrollStep(100, 100, 700)).toBe(-14);
    expect(autoScrollStep(145, 100, 700)).toBe(-7);
    expect(autoScrollStep(700, 100, 700)).toBe(14);
    expect(autoScrollStep(900, 100, 700)).toBe(14);
  });
});

describe("isHorizontalStart", () => {
  it("needs |dx| >= 1.2 |dy|", () => {
    expect(isHorizontalStart(12, 10)).toBe(true);
    expect(isHorizontalStart(11, 10)).toBe(false);
    expect(isHorizontalStart(0, 8)).toBe(false);
  });
});
