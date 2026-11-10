import { describe, expect, it } from "vitest";
import { buildInfoRows, buildSelectionRows, formatCoordinates, formatDateRange, formatLocationLine } from "./viewerInfo";

const none = { place: null, place_address: null, latitude: null, longitude: null };

describe("place label", () => {
  it("shows the library's place text unchanged, address first", () => {
    expect(formatLocationLine({ ...none, place: "Zürich", place_address: "Bahnhofstrasse 1, Zürich" })).toBe(
      "Bahnhofstrasse 1, Zürich",
    );
    expect(formatLocationLine({ ...none, place: "Zürich", latitude: 1, longitude: 2 })).toBe("Zürich");
  });

  it("falls back to formatted coordinates for GPS without a place record", () => {
    expect(formatLocationLine({ ...none, latitude: 52.2297, longitude: 21.0122 })).toBe("52.2297° N, 21.0122° E");
    expect(formatCoordinates(-33.8688, -70.5)).toBe("33.8688° S, 70.5000° W");
  });

  it("says Unknown place for unusable GPS and nothing without GPS", () => {
    expect(formatLocationLine({ ...none, latitude: 95, longitude: 0 })).toBe("Unknown place");
    expect(formatLocationLine({ ...none, latitude: 10, longitude: null })).toBe("Unknown place");
    expect(formatLocationLine(none)).toBe("");
    expect(buildInfoRows({ ...none, people: [], albums: [], date_created: null } as never)).toEqual([]);
  });
});

describe("selection summary rows (D21)", () => {
  it("formats date ranges", () => {
    expect(formatDateRange("2024-03-03T10:00:00", "2024-03-09T10:00:00")).toBe("3–9 Mar 2024");
    expect(formatDateRange("2024-03-03T10:00:00", "2024-03-03T18:00:00")).toBe("3 Mar 2024");
    expect(formatDateRange("2024-02-28T10:00:00", "2024-03-03T10:00:00")).toBe("28 Feb – 3 Mar 2024");
    expect(formatDateRange("2023-12-28T10:00:00", "2024-01-03T10:00:00")).toBe("28 Dec 2023 – 3 Jan 2024");
    expect(formatDateRange(null, null)).toBe("");
  });

  it("splits photos and videos only when both are present", () => {
    const base = { date_first: null, date_last: null, total_bytes: 1024, place: null };
    expect(buildSelectionRows({ ...base, count: 3, photos: 2, videos: 1 })[0].value).toBe("3 items (2 photos, 1 video)");
    expect(buildSelectionRows({ ...base, count: 2, photos: 2, videos: 0 })[0].value).toBe("2 photos");
    expect(buildSelectionRows({ ...base, count: 2, photos: 0, videos: 2 })[0].value).toBe("2 videos");
  });
});
