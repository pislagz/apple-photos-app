import { describe, expect, it } from "vitest";
import { measureStandaloneGap } from "./standaloneGap";

function fakeWin(standalone: boolean, inner: [number, number], screen: [number, number]) {
  return {
    innerWidth: inner[0],
    innerHeight: inner[1],
    screen: { width: screen[0], height: screen[1] },
    matchMedia: () => ({ matches: false }),
    navigator: { standalone },
  };
}

describe("standalone gap (#407)", () => {
  it("measures the missing status-bar height in an iOS home-screen app", () => {
    expect(measureStandaloneGap(fakeWin(true, [393, 793], [393, 852]))).toBe(59);
  });
  it("is 0 in a normal browser tab", () => {
    expect(measureStandaloneGap(fakeWin(false, [393, 700], [393, 852]))).toBe(0);
  });
  it("is 0 when iOS already gives the full height", () => {
    expect(measureStandaloneGap(fakeWin(true, [393, 852], [393, 852]))).toBe(0);
  });
  it("ignores big gaps that are not the status-bar bug (keyboard)", () => {
    expect(measureStandaloneGap(fakeWin(true, [393, 500], [393, 852]))).toBe(0);
  });
  it("uses the short screen side in landscape", () => {
    expect(measureStandaloneGap(fakeWin(true, [852, 393], [393, 852]))).toBe(0);
  });
});
