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

// #475: half the old 0.01, so a Mac pinch follows the fingers instead of
// racing ahead of them.
export const WHEEL_ZOOM_RATE = 0.005;
// #475: the viewer eases toward the pinch target with this time constant.
export const PINCH_SMOOTH_MS = 70;
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

// #475: the desktop grid scales live with the fingers, then settles. A session
// accumulates the pinch into one scale (clamped), reports it on every event,
// and settles once the pinch ends: a gestureend (Safari) or PINCH_SETTLE_MS of
// silence (ctrl+wheel, which has no end event and trails off with inertia).
export const PINCH_SETTLE_MS = 140;
export const PINCH_MIN_SCALE = 0.5;
export const PINCH_MAX_SCALE = 2;
// A pinch must travel about 25 % (log scale) to move the grid one size stop.
export const PINCH_STEP_THRESHOLD = Math.log(1.25);

export function pinchDirection(scale: number, threshold = PINCH_STEP_THRESHOLD): -1 | 0 | 1 {
  const travel = Math.log(scale);
  return Math.abs(travel) < threshold ? 0 : travel > 0 ? 1 : -1;
}

export interface PinchSession {
  push(pinch: TrackpadPinch): void;
  end(): void;
  cancel(): void;
}

export function createPinchSession({
  onScale,
  onSettle,
  settleMs = PINCH_SETTLE_MS,
}: {
  onScale: (scale: number, origin: { clientX: number; clientY: number }) => void;
  onSettle: (scale: number, origin: { clientX: number; clientY: number }) => void;
  settleMs?: number;
}): PinchSession {
  let scale = 1;
  let active = false;
  let origin = { clientX: 0, clientY: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const finish = () => {
    clear();
    if (!active) return;
    const settled = scale;
    active = false;
    scale = 1;
    onSettle(settled, origin);
  };
  return {
    push(pinch) {
      if (!(pinch.factor > 0)) return;
      if (!active) {
        active = true;
        scale = 1;
        origin = { clientX: pinch.clientX, clientY: pinch.clientY };
      }
      scale = Math.min(PINCH_MAX_SCALE, Math.max(PINCH_MIN_SCALE, scale * pinch.factor));
      onScale(scale, origin);
      clear();
      timer = setTimeout(finish, settleMs);
    },
    end: finish,
    cancel() {
      clear();
      active = false;
      scale = 1;
    },
  };
}
