import { describe, expect, it } from "vitest";
import { parsePhotoPath } from "./route";

describe("parsePhotoPath", () => {
  it("parses a Copy Link URL's path", () => {
    expect(parsePhotoPath("/library/1/photo/a1")).toEqual({ libraryId: 1, assetId: "a1" });
  });

  it("decodes a URL-encoded asset id", () => {
    expect(parsePhotoPath("/library/1/photo/a%201")).toEqual({ libraryId: 1, assetId: "a 1" });
  });

  it("ignores a trailing slash", () => {
    expect(parsePhotoPath("/library/1/photo/a1/")).toEqual({ libraryId: 1, assetId: "a1" });
  });

  it("returns null for any other path", () => {
    expect(parsePhotoPath("/")).toBeNull();
    expect(parsePhotoPath("/library/1")).toBeNull();
    expect(parsePhotoPath("/library/abc/photo/a1")).toBeNull();
  });
});
