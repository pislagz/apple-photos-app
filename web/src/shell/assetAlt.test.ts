import { describe, expect, it } from "vitest";
import { assetAlt } from "./assetAlt";

describe("assetAlt", () => {
  it("prefers the title", () => {
    expect(assetAlt({ title: " Beach day ", date: "2024-03-05T12:00:00" })).toBe("Beach day");
  });
  it("falls back to the date, with the media kind", () => {
    expect(assetAlt({ title: null, date: "2024-03-05T12:00:00" })).toBe("Photo from March 5, 2024");
    expect(assetAlt({ date: "2024-03-05T12:00:00", is_video: true })).toBe("Video from March 5, 2024");
  });
  it("is never empty and never the filename", () => {
    expect(assetAlt({ title: "", date: null })).toBe("Photo");
    expect(assetAlt({ date: "not a date" })).toBe("Photo");
    expect(assetAlt({ date: null, is_video: true })).toBe("Video");
    expect(assetAlt({ filename: "IMG_0001.HEIC", date: null } as never)).not.toContain("IMG_");
  });
});
