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
    expect(parseMobileRoute("/places/1%2C2%2C3%2C4")).toEqual({ tab: "more", screen: "places", bbox: "1,2,3,4" });
    expect(mobileRoutePath({ tab: "more", screen: "places", bbox: "1,2,3,4" })).toBe("/places/1%2C2%2C3%2C4");
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

describe("People routes (P2.2)", () => {
  it("round-trips a person", () => {
    const route: MobileRoute = { tab: "more", screen: "people", personId: "P-1" };
    expect(mobileRoutePath(route)).toBe("/people/P-1");
    expect(parseMobileRoute("/people/P-1")).toEqual(route);
  });
});

describe("Albums routes (P2.1)", () => {
  it("round-trips a folder, an album and a smart album", () => {
    for (const route of [
      { tab: "albums", folderId: "F-1" },
      { tab: "albums", albumId: "A-1" },
      { tab: "albums", albumId: "smart:live-photos" },
    ] as MobileRoute[]) {
      expect(parseMobileRoute(mobileRoutePath(route))).toEqual(route);
    }
    expect(mobileRoutePath({ tab: "albums", folderId: "F-1" })).toBe("/albums/folder/F-1");
  });
});

describe("malformed percent escapes", () => {
  it("do not throw; the path just matches nothing", () => {
    for (const path of ["/places/%E0", "/people/%E0", "/media/%E0", "/albums/%E0", "/albums/folder/%E0"]) {
      expect(() => parseMobileRoute(path)).not.toThrow();
      expect(parseMobileRoute(path)).toEqual({ tab: "library" });
    }
    expect(parsePhotoPath("/library/1/photo/%E0")).toBeNull();
  });
});

describe("Search routes (P2.4)", () => {
  it("round-trips a query and keeps /search as the empty field", () => {
    expect(parseMobileRoute("/search")).toEqual({ tab: "search" });
    const route: MobileRoute = { tab: "search", query: "dog beach/2024" };
    expect(mobileRoutePath(route)).toBe("/search/dog%20beach%2F2024");
    expect(parseMobileRoute(mobileRoutePath(route))).toEqual(route);
    expect(parseMobileRoute("/search/%E0")).toEqual({ tab: "library" });
  });
});
