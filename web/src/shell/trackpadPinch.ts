// #457: a desktop trackpad pinch, normalised. Chromium and Firefox report it
// as ctrl+wheel; Safari as gesturestart/gesturechange/gestureend with a
// cumulative `scale`. The window-level blocker (blockPageZoom) only cancels the
// browser default, so these element listeners still see every event; they
// cancel it too, so the page never zooms. Touch pinch on the iPhone is a
// different path (usePinchZoom) and never reaches here.

export interface TrackpadPinch {
  // Multiplicative change since the previous event: > 1 spreads (zoom in).
  factor: number;
  clientX: number;
  clientY: number;
}

// Same curve the viewer has always used for ctrl+wheel (gestures.wheelScale).
export const WHEEL_ZOOM_RATE = 0.01;
const LINE_PX = 16;

export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * 800 : deltaY;
  return Math.exp(-px * WHEEL_ZOOM_RATE);
}

interface SafariGestureEvent extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

export function listenTrackpadPinch(
  element: HTMLElement,
  onPinch: (pinch: TrackpadPinch) => void,
  onEnd?: () => void,
): () => void {
  // Safari: the gesture events carry the pinch; ignore any ctrl+wheel it may
  // also send meanwhile, so a pinch is never counted twice.
  let gestureScale: number | null = null;

  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    if (gestureScale !== null) return;
    onPinch({ factor: wheelFactor(event.deltaY, event.deltaMode), clientX: event.clientX, clientY: event.clientY });
  };
  const onGestureStart = (event: Event) => {
    event.preventDefault();
    gestureScale = 1;
  };
  const onGestureChange = (event: Event) => {
    event.preventDefault();
    const gesture = event as SafariGestureEvent;
    if (!(gesture.scale > 0)) return;
    const previous = gestureScale ?? 1;
    gestureScale = gesture.scale;
    onPinch({ factor: gesture.scale / previous, clientX: gesture.clientX, clientY: gesture.clientY });
  };
  const onGestureEnd = (event: Event) => {
    event.preventDefault();
    gestureScale = null;
    onEnd?.();
  };

  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("gesturestart", onGestureStart);
  element.addEventListener("gesturechange", onGestureChange);
  element.addEventListener("gestureend", onGestureEnd);
  return () => {
    element.removeEventListener("wheel", onWheel);
    element.removeEventListener("gesturestart", onGestureStart);
    element.removeEventListener("gesturechange", onGestureChange);
    element.removeEventListener("gestureend", onGestureEnd);
  };
}

// The desktop grid moves one stop of its size scale per pinch, never more.
// A pinch must travel PINCH_STEP_THRESHOLD (log scale, about 25 %) before it
// steps; then it is spent until the fingers stop (a gestureend, or no event
// for PINCH_IDLE_MS), and the next pinch is ignored for PINCH_COOLDOWN_MS
// after a step so a trailing burst cannot step again.
export const PINCH_STEP_THRESHOLD = Math.log(1.25);
export const PINCH_IDLE_MS = 250;
export const PINCH_COOLDOWN_MS = 400;

export interface PinchStepper {
  // Returns +1 (bigger tiles), -1 (smaller) or 0.
  push(factor: number, now: number): -1 | 0 | 1;
  end(): void;
}

export function createPinchStepper({
  threshold = PINCH_STEP_THRESHOLD,
  idleMs = PINCH_IDLE_MS,
  cooldownMs = PINCH_COOLDOWN_MS,
} = {}): PinchStepper {
  let sum = 0;
  let spent = false;
  let lastAt = -Infinity;
  let steppedAt = -Infinity;
  return {
    push(factor, now) {
      if (now - lastAt > idleMs) {
        sum = 0;
        spent = false;
      }
      lastAt = now;
      if (spent || now - steppedAt < cooldownMs || !(factor > 0)) return 0;
      sum += Math.log(factor);
      if (Math.abs(sum) < threshold) return 0;
      const direction = sum > 0 ? 1 : -1;
      sum = 0;
      spent = true;
      steppedAt = now;
      return direction;
    },
    end() {
      sum = 0;
      spent = false;
      lastAt = -Infinity;
    },
  };
}
