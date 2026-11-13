import { describe, expect, it } from "vitest";
import { clampScale, levelAfter, levelIndex, stepsForScale } from "./zoomLevels";

describe("zoom levels (#213)", () => {
  it("maps release scale to levels with the issue thresholds", () => {
    expect([4, 2.3, 2.2, 1.13, 1.12, 1, 0.88, 0.87, 0.45, 0.44].map(stepsForScale)).toEqual([2, 2, 1, 1, 0, 0, 0, -1, -1, -2]);
  });

  it("clamps the live scale to 0.25-4", () => {
    expect([clampScale(0.1), clampScale(1.5), clampScale(9)]).toEqual([0.25, 1.5, 4]);
  });

  it("walks Years, Months, 5, 3, 1 columns", () => {
    expect(levelAfter("all", 3, 1)).toMatchObject({ view: "all", columns: 1 });
    expect(levelAfter("all", 3, -1)).toMatchObject({ view: "all", columns: 5 });
    expect(levelAfter("all", 3, -2)).toMatchObject({ view: "months" });
    expect(levelAfter("all", 3, -3)).toMatchObject({ view: "years" });
    expect(levelAfter("all", 3, -9)).toMatchObject({ view: "years" });
    expect(levelAfter("years", 3, 9)).toMatchObject({ view: "all", columns: 1 });
    expect(levelAfter("months", 1, 1)).toMatchObject({ view: "all", columns: 5 });
  });

  it("treats Days as the 5-column step", () => {
    expect(levelIndex("days", 3)).toBe(2);
    expect(levelAfter("days", 3, -1).view).toBe("months");
    expect(levelAfter("days", 3, 1)).toMatchObject({ view: "all", columns: 3 });
  });

  it("keeps the column count while on Years or Months", () => {
    expect(levelAfter("all", 1, -4)).toMatchObject({ view: "years", columns: 1 });
  });
});
