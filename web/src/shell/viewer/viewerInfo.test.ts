import { describe, expect, it } from "vitest";
import { buildInfoRows, formatCoordinates, formatLocationLine } from "./viewerInfo";

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
