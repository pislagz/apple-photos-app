import { describe, expect, it } from "vitest";
import { type MobileRoute, mobileRoutePath, parseMobileRoute, parsePhotoPath } from "./route";

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

describe("parseMobileRoute", () => {
  it("parses each tab", () => {
    expect(parseMobileRoute("/")).toEqual({ tab: "library" });
    expect(parseMobileRoute("/albums")).toEqual({ tab: "albums" });
    expect(parseMobileRoute("/search")).toEqual({ tab: "search" });
    expect(parseMobileRoute("/more")).toEqual({ tab: "more" });
  });

  it("parses the More screens by their own stable route, independent of the More tab", () => {
    expect(parseMobileRoute("/people")).toEqual({ tab: "more", screen: "people" });
    expect(parseMobileRoute("/places")).toEqual({ tab: "more", screen: "places" });
    expect(parseMobileRoute("/hidden")).toEqual({ tab: "more", screen: "hidden" });
    expect(parseMobileRoute("/media/videos")).toEqual({ tab: "more", screen: "media", mediaType: "videos" });
  });

  it("decodes a URL-encoded media type slug", () => {
    expect(parseMobileRoute("/media/slo%2Dmo")).toEqual({ tab: "more", screen: "media", mediaType: "slo-mo" });
  });

  it("falls back to the library tab for an unknown path", () => {
    expect(parseMobileRoute("/nonsense")).toEqual({ tab: "library" });
  });
});

describe("mobileRoutePath", () => {
  it("round-trips every route through parseMobileRoute", () => {
    const routes: MobileRoute[] = [
      { tab: "library" },
      { tab: "albums" },
      { tab: "search" },
      { tab: "more" },
      { tab: "more", screen: "people" },
      { tab: "more", screen: "places" },
      { tab: "more", screen: "hidden" },
      { tab: "more", screen: "media", mediaType: "videos" },
    ];
    for (const route of routes) {
      expect(parseMobileRoute(mobileRoutePath(route))).toEqual(route);
    }
  });
});
