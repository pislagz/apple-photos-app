import { afterEach, describe, expect, it, vi } from "vitest";
import { installBlockPageZoom } from "./blockPageZoom";
import {
  PINCH_MAX_SCALE,
  PINCH_SETTLE_MS,
  createPinchSession,
  pinchDirection,
  listenTrackpadPinch,
  wheelFactor,
} from "./trackpadPinch";

describe("pinch session (#475)", () => {
  const at = { clientX: 5, clientY: 6 };
  function setup() {
    vi.useFakeTimers();
    const scales: number[] = [];
    const settled: number[] = [];
    const session = createPinchSession({ onScale: (s) => scales.push(s), onSettle: (s) => settled.push(s) });
    return { scales, settled, session };
  }
  afterEach(() => vi.useRealTimers());

  it("reports a live cumulative scale on every event, then settles once at the end", () => {
    const { scales, settled, session } = setup();
    session.push({ factor: 1.1, ...at });
    session.push({ factor: 1.1, ...at });
    expect(scales[1]).toBeCloseTo(1.21);
    expect(settled).toEqual([]);
    session.end();
    expect(settled[0]).toBeCloseTo(1.21);
    session.end();
    expect(settled).toHaveLength(1);
  });

  it("settles after silence when there is no end event (ctrl+wheel)", () => {
    const { settled, session } = setup();
    session.push({ factor: 0.8, ...at });
    vi.advanceTimersByTime(PINCH_SETTLE_MS - 1);
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(settled).toEqual([0.8]);
  });

  it("clamps the live scale and starts the next pinch from 1", () => {
    const { scales, settled, session } = setup();
    session.push({ factor: 100, ...at });
    expect(scales[0]).toBe(PINCH_MAX_SCALE);
    session.end();
    session.push({ factor: 1.2, ...at });
    expect(scales[1]).toBeCloseTo(1.2);
    session.cancel();
    vi.advanceTimersByTime(1000);
    expect(settled).toEqual([PINCH_MAX_SCALE]);
  });

  it("steps one stop only past the threshold", () => {
    expect(pinchDirection(1.1)).toBe(0);
    expect(pinchDirection(0.9)).toBe(0);
    expect(pinchDirection(1.3)).toBe(1);
    expect(pinchDirection(0.7)).toBe(-1);
  });

  it("drives a session from synthetic Safari gesture events", () => {
    const { scales, settled, session } = setup();
    const el = document.createElement("div");
    const stop = listenTrackpadPinch(el, (p) => session.push(p), () => session.end());
    const gesture = (type: string, scale = 1) => {
      const e = new Event(type, { cancelable: true }) as Event & { scale: number };
      e.scale = scale;
      el.dispatchEvent(e);
      return e;
    };
    gesture("gesturestart");
    expect(gesture("gesturechange", 1.1).defaultPrevented).toBe(true);
    gesture("gesturechange", 1.4);
    expect(scales.at(-1)).toBeCloseTo(1.4);
    gesture("gestureend", 1.4);
    expect(settled[0]).toBeCloseTo(1.4);
    stop();
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
