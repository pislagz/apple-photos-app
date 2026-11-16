import { afterEach, describe, expect, it, vi } from "vitest";
import { installBlockPageZoom } from "./blockPageZoom";
import {
  PINCH_COOLDOWN_MS,
  PINCH_IDLE_MS,
  createPinchStepper,
  listenTrackpadPinch,
  wheelFactor,
} from "./trackpadPinch";

describe("pinch stepper (#457)", () => {
  it("steps once the pinch passes the threshold, in the pinch direction", () => {
    const zoomIn = createPinchStepper();
    expect(zoomIn.push(1.1, 0)).toBe(0); // under the threshold
    expect(zoomIn.push(1.2, 16)).toBe(1);
    const zoomOut = createPinchStepper();
    expect(zoomOut.push(0.9, 0)).toBe(0);
    expect(zoomOut.push(0.85, 16)).toBe(-1);
  });

  it("small back-and-forth jitter never steps", () => {
    const stepper = createPinchStepper();
    for (let t = 0; t < 2000; t += 16) expect(stepper.push(t % 32 ? 1.05 : 1 / 1.05, t)).toBe(0);
  });

  it("one continuous pinch steps at most once, however far it goes", () => {
    const stepper = createPinchStepper();
    const steps: number[] = [];
    for (let t = 0; t < 3000; t += 16) steps.push(stepper.push(1.1, t));
    expect(steps.filter((s) => s !== 0)).toEqual([1]);
  });

  it("a new pinch after the fingers stop steps again", () => {
    const stepper = createPinchStepper();
    expect(stepper.push(2, 0)).toBe(1);
    expect(stepper.push(2, 100)).toBe(0); // same pinch
    const later = 100 + PINCH_IDLE_MS + PINCH_COOLDOWN_MS;
    expect(stepper.push(2, later)).toBe(1);
  });

  it("ignores a new pinch inside the cooldown", () => {
    const stepper = createPinchStepper();
    expect(stepper.push(2, 0)).toBe(1);
    stepper.end(); // gestureend
    expect(stepper.push(2, PINCH_COOLDOWN_MS - 1)).toBe(0);
    stepper.end();
    expect(stepper.push(2, PINCH_COOLDOWN_MS + 1)).toBe(1);
  });

  it("gestureend lets the next pinch start from zero", () => {
    const stepper = createPinchStepper();
    expect(stepper.push(1.2, 0)).toBe(0);
    stepper.end();
    expect(stepper.push(1.2, 10)).toBe(0); // the earlier 1.2 was dropped
  });
});

describe("wheelFactor", () => {
  it("spreads (negative deltaY) above 1, pinches below 1", () => {
    expect(wheelFactor(-10)).toBeGreaterThan(1);
    expect(wheelFactor(10)).toBeLessThan(1);
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(-1, 1)).toBeCloseTo(wheelFactor(-16));
  });
});

describe("listenTrackpadPinch (#457)", () => {
  let cleanup: (() => void)[] = [];
  afterEach(() => {
    for (const fn of cleanup) fn();
    cleanup = [];
    document.body.innerHTML = "";
  });

  function setup() {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const onPinch = vi.fn();
    const onEnd = vi.fn();
    cleanup.push(installBlockPageZoom(), listenTrackpadPinch(element, onPinch, onEnd));
    return { element, onPinch, onEnd };
  }

  function gesture(type: string, scale: number) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { scale, clientX: 5, clientY: 6 });
    return event;
  }

  it("reaches the element behind the page-zoom block, and still cancels the page zoom", () => {
    const { element, onPinch } = setup();
    const pinch = new WheelEvent("wheel", { ctrlKey: true, deltaY: -20, clientX: 3, clientY: 4, cancelable: true, bubbles: true });
    element.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);
    expect(onPinch).toHaveBeenCalledWith({ factor: wheelFactor(-20), clientX: 3, clientY: 4 });
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, cancelable: true, bubbles: true }));
    expect(onPinch).toHaveBeenCalledTimes(1); // plain scrolling is not a pinch
  });

  it("turns Safari's cumulative gesture scale into per-event factors", () => {
    const { element, onPinch, onEnd } = setup();
    const events = [gesture("gesturestart", 1), gesture("gesturechange", 1.2), gesture("gesturechange", 1.5), gesture("gestureend", 1.5)];
    for (const event of events) element.dispatchEvent(event);
    expect(events.every((event) => event.defaultPrevented)).toBe(true);
    expect(onPinch.mock.calls.map(([p]) => p.factor)).toEqual([1.2, 1.5 / 1.2]);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("does not count a ctrl+wheel sent during a Safari gesture twice", () => {
    const { element, onPinch } = setup();
    element.dispatchEvent(gesture("gesturestart", 1));
    element.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: -20, cancelable: true, bubbles: true }));
    expect(onPinch).not.toHaveBeenCalled();
  });
});
