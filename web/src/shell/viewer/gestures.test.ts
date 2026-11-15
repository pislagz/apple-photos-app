import { describe, expect, it } from "vitest";
import * as g from "./gestures";

describe("paging", () => {
  const W = 400;
  it("commits past 15 % of the width, not before", () => {
    expect(g.pageDecision(-61, 0, W, true, true)).toBe("next");
    expect(g.pageDecision(-59, 0, W, true, true)).toBe("stay");
    expect(g.pageDecision(61, 0, W, true, true)).toBe("prev");
  });
  it("commits on velocity above 0.25 px/ms, not at or below it", () => {
    expect(g.pageDecision(-30, -0.26, W, true, true)).toBe("next");
    expect(g.pageDecision(-30, -0.25, W, true, true)).toBe("stay");
    expect(g.pageDecision(30, 0.6, W, true, true)).toBe("prev");
  });
  it("never commits past the ends", () => {
    expect(g.pageDecision(300, 0, W, false, true)).toBe("stay");
    expect(g.pageDecision(-300, 0, W, true, false)).toBe("stay");
  });
  it("rubber-bands only against the ends, and never beyond the width", () => {
    expect(g.pagingOffset(-120, true, true, W)).toBe(-120);
    const banded = g.pagingOffset(120, false, true, W);
    expect(banded).toBeGreaterThan(0);
    expect(banded).toBeLessThan(120);
    expect(g.pagingOffset(10_000, false, true, W)).toBeLessThan(W);
    expect(g.pagingOffset(-120, true, false, W)).toBeLessThan(0);
  });
  it("settles one page plus the 16 px gap away", () => {
    expect(g.pageTarget("next", W)).toBe(-416);
    expect(g.pageTarget("prev", W)).toBe(416);
    expect(g.pageTarget("stay", W)).toBe(0);
  });
});

describe("dismiss", () => {
  it("shrinks towards 0.8 and fades to nothing at 300 px", () => {
    expect(g.dismissLook(0)).toEqual({ scale: 1, background: 1 });
    expect(g.dismissLook(150).scale).toBeCloseTo(0.9);
    expect(g.dismissLook(150).background).toBeCloseTo(0.5);
    expect(g.dismissLook(300)).toEqual({ scale: 0.8, background: 0 });
    expect(g.dismissLook(900).scale).toBeCloseTo(0.8);
    expect(g.dismissLook(-20)).toEqual({ scale: 1, background: 1 });
  });
  it("dismisses past 100 px or faster than 0.6 px/ms", () => {
    expect(g.shouldDismiss(101, 0)).toBe(true);
    expect(g.shouldDismiss(100, 0)).toBe(false);
    expect(g.shouldDismiss(40, 0.61)).toBe(true);
    expect(g.shouldDismiss(40, 0.6)).toBe(false);
    expect(g.shouldDismiss(2, 5)).toBe(false); // a twitch is not a flick
  });
  it("locks the axis only after 8 px, to the dominant direction", () => {
    expect(g.lockAxis(3, 4)).toBeNull();
    expect(g.lockAxis(2, 20)).toBe("vertical");
    expect(g.lockAxis(20, -2)).toBe("horizontal");
  });
});

describe("velocity", () => {
  it("uses the last 100 ms only", () => {
    const samples = [
      { x: 0, y: 0, t: 0 },
      { x: 500, y: 0, t: 50 },
      { x: 500, y: 0, t: 400 },
      { x: 530, y: 0, t: 500 },
    ];
    expect(g.velocityOf(samples).x).toBeCloseTo(0.3);
  });
  it("is zero with one sample", () => {
    expect(g.velocityOf([{ x: 1, y: 1, t: 5 }])).toEqual({ x: 0, y: 0 });
    expect(g.velocityOf([])).toEqual({ x: 0, y: 0 });
  });
});

describe("zoom", () => {
  const box = { w: 400, h: 800 };
  const fit = g.fitSize({ w: 4000, h: 3000 }, box); // 400 x 300
  it("clamps to 1-6", () => {
    expect(g.clampZoom(0.2)).toBe(1);
    expect(g.clampZoom(9)).toBe(6);
    expect(g.clampZoom(3)).toBe(3);
  });
  it("rubber-bands a little past the limits only", () => {
    expect(g.softZoom(3)).toBe(3);
    expect(g.softZoom(8)).toBeGreaterThan(6);
    expect(g.softZoom(1000)).toBeLessThanOrEqual(6.5);
    expect(g.softZoom(0.5)).toBeLessThan(1);
    expect(g.softZoom(0)).toBeGreaterThanOrEqual(0.85);
  });
  it("keeps the pinch midpoint fixed on screen", () => {
    const focal = { x: 80, y: -40 };
    const next = g.zoomAbout({ x: 0, y: 0 }, 1, 2, focal);
    // content point p under focal: focal = 1*p + 0  ->  after: 2*p + t == focal
    expect(2 * focal.x + next.x).toBeCloseTo(focal.x);
    expect(2 * focal.y + next.y).toBeCloseTo(focal.y);
  });
  it("pan bounds stop the edge at the viewport edge; a short axis cannot pan", () => {
    const bounds = g.panBounds(2.5, fit, box); // 1000 x 750 drawn
    expect(bounds.x).toBeCloseTo(300);
    expect(bounds.y).toBe(0); // 750 < 800
    expect(g.clampPan({ x: 999, y: 50 }, bounds)).toEqual({ x: 300, y: 0 });
    expect(g.clampPan({ x: -999, y: -50 }, bounds)).toEqual({ x: -300, y: -0 });
  });
  it("double tap toggles fit and 2.5x, centring the tap within the bounds", () => {
    const zoomed = g.toggleZoom(g.FIT, { x: 100, y: 0 }, fit, box);
    expect(zoomed.scale).toBe(2.5);
    expect(zoomed.x).toBe(-250); // 100 * 2.5, inside the 300 bound
    expect(g.toggleZoom(zoomed, { x: 0, y: 0 }, fit, box)).toEqual(g.FIT);
    expect(g.toggleZoom(g.FIT, { x: 190, y: 0 }, fit, box).x).toBe(-300); // clamped
  });
  it("settles back into 1-6 and the pan bounds after a pinch", () => {
    expect(g.settleView({ scale: 6.4, x: 9999, y: 0 }, fit, box)).toEqual({ scale: 6, x: 1000, y: 0 });
    expect(g.settleView({ scale: 0.9, x: 5, y: 5 }, fit, box)).toEqual(g.FIT);
  });
  it("wheel zoom is clamped to 1-6", () => {
    expect(g.wheelScale(1, 10_000)).toBe(1);
    expect(g.wheelScale(5, -10_000)).toBe(6);
    expect(g.wheelScale(2, -10)).toBeGreaterThan(2);
  });
});

describe("desktop mouse drag at fit (#267)", () => {
  const box = { w: 1440, h: 856 };
  it("follows the locked axis, and only downwards for dismiss", () => {
    expect(g.fitDragView({ dx: 3, dy: 2 })).toEqual(g.FIT);
    expect(g.fitDragView({ dx: -120, dy: 10 })).toEqual({ scale: 1, x: -120, y: 0 });
    expect(g.fitDragView({ dx: 5, dy: 150 })).toEqual({ scale: g.dismissLook(150).scale, x: 0, y: 150 });
    expect(g.fitDragView({ dx: 5, dy: -150 })).toEqual(g.FIT);
  });
  it("pages past 80 px, closes past 100 px down, otherwise snaps back", () => {
    expect(g.fitDragOutcome({ dx: -81, dy: 0 }, box)).toBe("next");
    expect(g.fitDragOutcome({ dx: 81, dy: 0 }, box)).toBe("prev");
    expect(g.fitDragOutcome({ dx: 79, dy: 0 }, box)).toBeNull();
    expect(g.fitDragOutcome({ dx: 0, dy: 101 }, box)).toBe("close");
    expect(g.fitDragOutcome({ dx: 0, dy: 99 }, box)).toBeNull();
    expect(g.fitDragOutcome({ dx: 0, dy: -300 }, box)).toBeNull();
  });
  it("on a narrow window pages past a quarter of the width", () => {
    expect(g.fitDragOutcome({ dx: -60, dy: 0 }, { w: 200, h: 400 })).toBe("next");
  });
});

describe("constants from #214", () => {
  it("match the issue", () => {
    expect(g.ORIGINAL_DWELL_MS).toBe(350);
    expect(g.PAGE_COMMIT_FRACTION).toBe(0.15);
    expect(g.PAGE_COMMIT_VELOCITY).toBe(0.25);
    expect(g.DISMISS_DISTANCE_PX).toBe(100);
    expect(g.DISMISS_VELOCITY).toBe(0.6);
    expect(g.DOUBLE_TAP_ZOOM).toBe(2.5);
    expect([g.ZOOM_MIN, g.ZOOM_MAX]).toEqual([1, 6]);
    expect(g.PAGE_SETTLE_MS).toBe(220);
    expect(g.SPRING_BACK_MS).toBe(250);
    expect(g.ZOOM_ANIM_MS).toBe(250);
    expect(g.ORIGINAL_FADE_MS).toBe(200);
  });
});
