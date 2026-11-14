import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TITLE_SCRIM_FADE_PX, desktopTitle, phoneTitle, titleScrimProgress } from "./libraryTitle";

describe("title scrim fade (#261)", () => {
  it("goes 0 -> 1 over the first 48 px of scroll", () => {
    expect(TITLE_SCRIM_FADE_PX).toBe(48);
    expect(titleScrimProgress(0)).toBe(0);
    expect(titleScrimProgress(-30)).toBe(0); // rubber-band overscroll
    expect(titleScrimProgress(Number.NaN)).toBe(0);
    expect(titleScrimProgress(12)).toBe(0.25);
    expect(titleScrimProgress(24)).toBe(0.5);
    expect(titleScrimProgress(48)).toBe(1);
    expect(titleScrimProgress(5000)).toBe(1);
  });

  it("is a light blur driven by --title-scrim, with no blur under Reduce Transparency", () => {
    const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
    const blur = /\.desktop-library__title-scrim::before \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(blur).toContain("backdrop-filter: var(--blur-thin)");
    expect(blur).toContain("opacity: var(--title-scrim, 1)");
    const tint = /\.desktop-library__title-scrim::after \{([^}]*var\(--scrim-title\)[^}]*)\}/.exec(css)?.[1] ?? "";
    expect(tint).toContain("opacity: calc(0.4 + 0.6 * var(--title-scrim, 1))");
    const reduced = /@media \(prefers-reduced-transparency: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(reduced).toContain("backdrop-filter: none");
  });
});

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

describe("desktopTitle order (#224)", () => {
  it("names the same range for oldest-first and newest-first dates", () => {
    const ascending = desktopTitle("all", ["2024-05-01T10:00:00", "2024-05-09T10:00:00"]);
    const descending = desktopTitle("all", ["2024-05-09T10:00:00", "2024-05-01T10:00:00"]);
    expect(ascending).toBe(descending);
    expect(ascending).toContain("–");
  });
});
