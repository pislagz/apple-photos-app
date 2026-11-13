import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatShortPlaceName } from "./viewerInfo";
import { formatClock, formatDesktopTitle, formatPosition, formatRelativeDay, formatViewerTitle } from "./viewerTitle";

// Fixed "now": Wednesday 2026-06-17 18:30 (browser-local). The tests pin the
// locale to en-GB so the expected strings are the ones in the pp screenshots.
const NOW = new Date(2026, 5, 17, 18, 30);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const real = Date.prototype.toLocaleDateString;
  const realTime = Date.prototype.toLocaleTimeString;
  vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (this: Date, _l, o) {
    return real.call(this, "en-GB", o);
  });
  vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (this: Date, _l, o) {
    return realTime.call(this, "en-GB", o);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("iOS date part (formatRelativeDay)", () => {
  it("says Today and Yesterday", () => {
    expect(formatRelativeDay("2026-06-17T09:05:00", NOW)).toBe("Today");
    expect(formatRelativeDay("2026-06-16T23:59:00", NOW)).toBe("Yesterday");
  });

  it("uses the weekday for the rest of the past 7 days", () => {
    expect(formatRelativeDay("2026-06-15T10:00:00", NOW)).toBe("Monday");
    expect(formatRelativeDay("2026-06-11T10:00:00", NOW)).toBe("Thursday");
  });

  it("uses day + month, no year, for older dates in the current year", () => {
    expect(formatRelativeDay("2026-06-10T10:00:00", NOW)).toBe("10 June");
    expect(formatRelativeDay("2026-01-02T10:00:00", NOW)).toBe("2 January");
  });

  it("adds the year for previous years", () => {
    expect(formatRelativeDay("2025-05-19T10:00:00", NOW)).toBe("19 May 2025");
    expect(formatRelativeDay("2025-12-31T10:00:00", NOW)).toBe("31 December 2025");
  });

  it("is empty for a missing or malformed date", () => {
    expect(formatRelativeDay(null, NOW)).toBe("");
    expect(formatRelativeDay("nope", NOW)).toBe("");
  });
});

describe("iOS title (formatViewerTitle)", () => {
  it("no place: date over the time without seconds", () => {
    expect(formatViewerTitle("2026-06-17T17:11:42", "", NOW)).toEqual({ primary: "Today", secondary: "17:11" });
    expect(formatViewerTitle("2025-05-19T09:37:00", "", NOW)).toEqual({ primary: "19 May 2025", secondary: "09:37" });
    expect(formatViewerTitle("2026-10-28T09:37:00", "", NOW).primary).toBe("28 October");
  });

  it("with a place: the place over \"date  time\" (two spaces)", () => {
    expect(formatViewerTitle("2025-05-19T09:37:00", "Yosemite National Park", NOW)).toEqual({
      primary: "Yosemite National Park",
      secondary: "19 May 2025  09:37",
    });
    expect(formatViewerTitle("2026-06-16T08:00:00", "Selva", NOW).secondary).toBe("Yesterday  08:00");
    expect(formatViewerTitle("2026-06-15T08:00:00", "Selva", NOW).secondary).toBe("Monday  08:00");
  });

  it("no date: the place alone, or nothing; never N of M", () => {
    expect(formatViewerTitle(null, "Oslo", NOW)).toEqual({ primary: "Oslo", secondary: "" });
    expect(formatViewerTitle(null, "", NOW)).toEqual({ primary: "", secondary: "" });
    expect(JSON.stringify(formatViewerTitle("2025-05-19T09:37:00", "Oslo", NOW))).not.toMatch(/ of /);
  });
});

describe("Mac title (formatDesktopTitle)", () => {
  const base = { dateCreated: "2026-06-01T15:28:39", index: 70_065, total: 71_246, now: NOW };

  it("no place: full date at time with seconds, over N of M", () => {
    const title = formatDesktopTitle({ ...base, place: "" });
    expect(title.primary).toBe("1 June 2026 at 15:28:39");
    expect(title.secondary).toBe(formatPosition(70_065, 71_246));
    expect(title.secondary).toMatch(/^70\D066 of 71\D246$/);
  });

  it("never says Today / Yesterday / a weekday, even for today", () => {
    const title = formatDesktopTitle({ ...base, dateCreated: "2026-06-17T09:05:07", place: "" });
    expect(title.primary).toBe("17 June 2026 at 09:05:07");
  });

  it("with a place: the place over \"date at time · N of M\"", () => {
    const title = formatDesktopTitle({ ...base, place: "Selva", dateCreated: "2026-06-01T15:39:06", index: 70_067 });
    expect(title.primary).toBe("Selva");
    expect(title.secondary).toMatch(/^1 June 2026 at 15:39:06 · 70\D068 of 71\D246$/);
  });

  it("no date: the place, then N of M; with neither only N of M", () => {
    expect(formatDesktopTitle({ place: "Selva", dateCreated: null, index: 0, total: 2 })).toEqual({ primary: "Selva", secondary: "1 of 2" });
    expect(formatDesktopTitle({ place: "", dateCreated: null, index: 0, total: 2 })).toEqual({ primary: "", secondary: "1 of 2" });
  });

  it("has no file name", () => {
    const title = formatDesktopTitle({ ...base, place: "" });
    expect(`${title.primary} ${title.secondary}`).not.toMatch(/IMG_|\.jpe?g|\.heic/i);
  });
});

describe("formatClock", () => {
  it("is 24 hour, seconds optional", () => {
    expect(formatClock("2026-06-17T09:05:07")).toBe("09:05");
    expect(formatClock("2026-06-17T21:05:07", true)).toBe("21:05:07");
    expect(formatClock(null)).toBe("");
  });
});

describe("formatShortPlaceName", () => {
  const d = (place: string | null, place_address: string | null, place_offline: string | null = null) => ({ place, place_address, place_offline });

  it("prefers Photos' own place name over the address", () => {
    expect(formatShortPlaceName(d("Selva", "Via Meisules 12, Selva, Italy"))).toBe("Selva");
  });

  it("uses the city of the offline name", () => {
    expect(formatShortPlaceName(d(null, null, "Warsaw, Poland"))).toBe("Warsaw");
  });

  it("from an address alone takes the first component that is not a street line", () => {
    expect(formatShortPlaceName(d(null, "Bahnhofstrasse 1, Zürich, Switzerland"))).toBe("Zürich");
    expect(formatShortPlaceName(d(null, "Yosemite National Park, CA, United States"))).toBe("Yosemite National Park");
    expect(formatShortPlaceName(d(null, "12"))).toBe("12");
  });

  it("is empty with nothing", () => {
    expect(formatShortPlaceName(d(null, null))).toBe("");
  });
});
