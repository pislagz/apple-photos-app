import { describe, expect, it } from "vitest";
import { computeAppHeight, type HeightInputs } from "./appHeight";

const base: HeightInputs = {
  standalone: true,
  innerHeight: 793, // 852 - 59: the cold-start bug
  clientHeight: 793,
  vvHeight: 793,
  screenWidth: 393,
  screenHeight: 852,
  portrait: true,
};

describe("computeAppHeight (#418)", () => {
  it("uses the full screen height for the short cold-start viewport", () => {
    expect(computeAppHeight(base)).toBe(852);
  });
  it("uses the full screen in landscape from the short side", () => {
    expect(
      computeAppHeight({ ...base, portrait: false, innerHeight: 340, clientHeight: 340, vvHeight: 340 }),
    ).toBe(393);
  });
  it("keeps a correct viewport as is", () => {
    expect(computeAppHeight({ ...base, innerHeight: 852, clientHeight: 852, vvHeight: 852 })).toBe(852);
  });
  it("follows the visual viewport while the keyboard is open", () => {
    expect(computeAppHeight({ ...base, innerHeight: 852, clientHeight: 852, vvHeight: 500 })).toBe(500);
  });
  it("does not stretch a much smaller area to the screen", () => {
    expect(computeAppHeight({ ...base, innerHeight: 600, clientHeight: 600, vvHeight: 600 })).toBe(600);
  });
  it("sets nothing when not standalone", () => {
    expect(computeAppHeight({ ...base, standalone: false })).toBeNull();
  });
});
