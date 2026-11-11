import { describe, expect, it } from "vitest";
import { formatClock, formatRelativeDay, formatViewerTitle } from "./viewerTitle";

// The long form is locale ordered (D Month YYYY, or Month D, YYYY in en-US).
// 2024-05-15 is a Wednesday. `now` is a local-time Date, like the browser's.
const NOW = new Date(2024, 4, 15, 18, 30);

describe("formatRelativeDay", () => {
  it("says Today and Yesterday", () => {
    expect(formatRelativeDay("2024-05-15T09:05:00", NOW)).toBe("Today");
    expect(formatRelativeDay("2024-05-14T23:59:00", NOW)).toBe("Yesterday");
  });

  it("uses the weekday for the rest of the past week", () => {
    expect(formatRelativeDay("2024-05-13T10:00:00", NOW)).toBe("Monday");
    expect(formatRelativeDay("2024-05-09T10:00:00", NOW)).toBe("Thursday");
  });

  it("uses D Month YYYY from a week ago on, and for the future", () => {
    expect(formatRelativeDay("2024-05-08T10:00:00", NOW)).toMatch(/^(8 May 2024|May 8, 2024)$/);
    expect(formatRelativeDay("2023-12-31T10:00:00", NOW)).toMatch(/^(31 December 2023|December 31, 2023)$/);
    expect(formatRelativeDay("2024-05-16T10:00:00", NOW)).toMatch(/^(16 May 2024|May 16, 2024)$/);
  });

  it("is empty for a missing or malformed date", () => {
    expect(formatRelativeDay(null, NOW)).toBe("");
    expect(formatRelativeDay("nope", NOW)).toBe("");
  });
});

describe("formatViewerTitle", () => {
  it("puts time and place on line 2", () => {
    expect(formatViewerTitle("2024-05-15T09:05:00", "Kraków, Poland", NOW)).toEqual({
      primary: "Today",
      secondary: `${formatClock("2024-05-15T09:05:00")} · Kraków, Poland`,
    });
    expect(formatClock("2024-05-15T09:05:00")).toMatch(/9:05/);
  });

  it("shows only the time when the photo has no place", () => {
    const title = formatViewerTitle("2024-05-14T09:05:00", "", NOW);
    expect(title.primary).toBe("Yesterday");
    expect(title.secondary).toBe(formatClock("2024-05-14T09:05:00"));
    expect(title.secondary).not.toContain("·");
  });

  it("falls back to the place alone without a date, and to nothing without both", () => {
    expect(formatViewerTitle(null, "Oslo", NOW)).toEqual({ primary: "Oslo", secondary: "" });
    expect(formatViewerTitle(null, "", NOW)).toEqual({ primary: "", secondary: "" });
  });
});
