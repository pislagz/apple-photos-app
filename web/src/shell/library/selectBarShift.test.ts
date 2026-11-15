import { describe, expect, it } from "vitest";
import { shouldKeepEndAboveBar } from "./selectBarShift";

describe("shouldKeepEndAboveBar", () => {
  it("scrolls to keep the newest row visible when the bar first appears at the end", () => {
    expect(shouldKeepEndAboveBar(0, 62, true, 0)).toBe(true);
  });

  it("does not move the grid when the bar grows later (first tile selected)", () => {
    expect(shouldKeepEndAboveBar(62, 125, true, 0)).toBe(false);
  });

  it("leaves a grid scrolled away from the end alone", () => {
    expect(shouldKeepEndAboveBar(0, 62, true, 500)).toBe(false);
  });

  it("only applies to the oldest-first layout and never when the bar shrinks", () => {
    expect(shouldKeepEndAboveBar(0, 62, false, 0)).toBe(false);
    expect(shouldKeepEndAboveBar(0, 0, true, 0)).toBe(false);
  });
});
