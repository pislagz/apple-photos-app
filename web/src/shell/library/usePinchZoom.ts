import { type TouchEvent, useRef } from "react";
import { clampScale } from "./zoomLevels";

export interface PinchPoint {
  clientX: number;
  clientY: number;
}

function distance(a: PinchPoint, b: PinchPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function midpointOf(a: PinchPoint, b: PinchPoint): PinchPoint {
  return { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 };
}

// Taps right after a pinch are the fingers lifting, not a choice (#213).
export const TAP_BLOCK_MS = 600;

// Reports the live pinch scale (clamped) and the final one on release; the
// caller decides what a scale means. Set `touch-action: pan-y` on the element
// so one-finger scrolling still works while a two-finger pinch reaches these
// handlers instead of the browser's own page zoom.
export function usePinchZoom(handlers: {
  onStart: (midpoint: PinchPoint) => void;
  onScale: (scale: number) => void;
  onEnd: (scale: number, midpoint: PinchPoint) => void;
}) {
  const pinch = useRef<{ start: number; scale: number; midpoint: PinchPoint } | null>(null);
  const blockedUntil = useRef(0);
  const latest = useRef(handlers);
  latest.current = handlers;

  function finish(scale: number) {
    const current = pinch.current;
    if (!current) return;
    pinch.current = null;
    blockedUntil.current = Date.now() + TAP_BLOCK_MS;
    latest.current.onEnd(scale, current.midpoint);
  }

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length !== 2) return;
    const [a, b] = [event.touches[0], event.touches[1]];
    const start = distance(a, b);
    if (start <= 0) return;
    const midpoint = midpointOf(a, b);
    pinch.current = { start, scale: 1, midpoint };
    latest.current.onStart(midpoint);
  }

  function onTouchMove(event: TouchEvent) {
    const current = pinch.current;
    if (!current || event.touches.length !== 2) return;
    current.scale = clampScale(distance(event.touches[0], event.touches[1]) / current.start);
    latest.current.onScale(current.scale);
  }

  function onTouchEnd(event: TouchEvent) {
    if (event.touches.length < 2) finish(pinch.current?.scale ?? 1);
  }

  return {
    // True for a moment after a pinch ends, so the lift is not read as a tap.
    tapBlocked: () => pinch.current !== null || Date.now() < blockedUntil.current,
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: () => finish(1) },
  };
}
