import { describe, expect, it } from "vitest";
import { desktopTitle, phoneTitle } from "./libraryTitle";

const dates = ["2025-09-19T10:00:00", "2025-08-30T10:00:00", "2025-08-08T10:00:00"];

describe("desktopTitle (#209)", () => {
  it("All Photos: the date range of what is visible, oldest first", () => {
    expect(desktopTitle("all", dates)).toBe("Aug 8, 2025 – Sep 19, 2025");
  });
  it("All Photos: one date when the range is a single day", () => {
    expect(desktopTitle("all", ["2025-09-19T10:00:00", "2025-09-19T08:00:00"])).toBe("Sep 19, 2025");
  });
  it("Months: Mon YYYY of the top row", () => {
    expect(desktopTitle("months", dates)).toBe("Sep 2025");
  });
  it("Years: YYYY of the top row", () => {
    expect(desktopTitle("years", dates)).toBe("2025");
  });
  it("is empty with nothing on screen", () => {
    expect(desktopTitle("all", [])).toBe("");
  });
});

describe("phoneTitle (#209)", () => {
  const top = "2025-09-05T10:00:00";
  it("finest levels (up to 5 columns): D Mon YYYY subtitle", () => {
    expect(phoneTitle(5, top)).toEqual({ subtitle: "5 Sep 2025", pill: "" });
    expect(phoneTitle(2, top).subtitle).toBe("5 Sep 2025");
  });
  it("one step coarser: Mon YYYY subtitle", () => {
    expect(phoneTitle(6, top)).toEqual({ subtitle: "Sep 2025", pill: "" });
  });
  it("coarsest level: a YYYY pill instead of the subtitle", () => {
    expect(phoneTitle(7, top)).toEqual({ subtitle: "", pill: "2025" });
  });
  it("is empty without a date", () => {
    expect(phoneTitle(4, undefined)).toEqual({ subtitle: "", pill: "" });
  });
});
