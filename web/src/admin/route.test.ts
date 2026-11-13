import { describe, expect, it } from "vitest";
import { parseHash, redirectFor, routeHash } from "./route";

describe("parseHash", () => {
  it("reads section names", () => {
    expect(parseHash("#devices")).toEqual({ section: "devices", id: null });
    expect(parseHash("#settings")).toEqual({ section: "settings", id: null });
  });
  it("maps the old names to the new ones", () => {
    expect(parseHash("#users").section).toBe("people");
    expect(parseHash("#access").section).toBe("sharing");
    expect(parseHash("#sessions").section).toBe("devices");
    expect(parseHash("#audit").section).toBe("activity");
    expect(parseHash("#audit-log").section).toBe("activity");
  });
  it("reads detail pages", () => {
    expect(parseHash("#libraries/3")).toEqual({
      section: "libraries",
      id: "3",
    });
    expect(parseHash("#users/al%20ice")).toEqual({
      section: "people",
      id: "al ice",
    });
  });
  it("drops an id on sections without detail pages", () => {
    expect(parseHash("#devices/9")).toEqual({ section: "devices", id: null });
  });
  it("keeps #map-place-names working", () => {
    expect(parseHash("#map-place-names")).toEqual({
      section: "settings",
      id: null,
    });
  });
  it("falls back to Libraries for empty or unknown hashes", () => {
    expect(parseHash("")).toEqual({ section: "libraries", id: null });
    expect(parseHash("#nonsense/1")).toEqual({
      section: "libraries",
      id: null,
    });
    expect(parseHash("#people/%E0%A4%A")).toEqual({
      section: "people",
      id: null,
    });
  });
});

describe("redirectFor", () => {
  it("redirects old hashes", () => {
    expect(redirectFor("#users")).toBe("#people");
    expect(redirectFor("#access")).toBe("#sharing");
    expect(redirectFor("#sessions")).toBe("#devices");
    expect(redirectFor("#audit")).toBe("#activity");
    expect(redirectFor("#users/bob")).toBe("#people/bob");
  });
  it("leaves new, empty and map-place-names hashes alone", () => {
    expect(redirectFor("#people/bob")).toBeNull();
    expect(redirectFor("")).toBeNull();
    expect(redirectFor("#map-place-names")).toBeNull();
  });
  it("rewrites unknown hashes", () => {
    expect(redirectFor("#nonsense")).toBe("#libraries");
  });
});

describe("routeHash", () => {
  it("round-trips", () => {
    expect(routeHash({ section: "people", id: "a b" })).toBe("#people/a%20b");
  });
});
