import { type TouchEvent, useRef, useState } from "react";

export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 7;

interface TouchPoint {
  clientX: number;
  clientY: number;
}

function distance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

// One column step per 25% change in the two-finger distance, so a single
// continued pinch can walk through several column counts.
const STEP_RATIO = 1.25;

export interface PinchColumnsResult {
  columns: number;
  // Same one-column step as a pinch, for the View Options menu. Positive
  // zooms in (fewer, larger columns).
  zoomBy: (steps: number) => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  touchHandlers: {
    onTouchStart: (event: TouchEvent) => void;
    onTouchMove: (event: TouchEvent) => void;
    onTouchEnd: (event: TouchEvent) => void;
  };
}

// Pinch-out (fingers spreading) is "zoom in": fewer, bigger columns.
// Pinch-in is "zoom out": more, smaller columns. Caller should set
// `touch-action: pan-y` on the element these handlers are attached to, so
// one-finger scrolling still works while two-finger pinch drives this
// instead of the browser's native pinch-zoom.
// `onBeforeChange` gets the pinch midpoint just before `columns` changes, so
// the caller can note what is under the fingers and re-anchor after reflow.
export function usePinchColumns(
  initial: number,
  onBeforeChange?: (midpoint: TouchPoint) => void,
  min = MIN_COLUMNS,
  max = MAX_COLUMNS,
): PinchColumnsResult {
  const [columns, setColumns] = useState(initial);
  const startDistance = useRef<number | null>(null);

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length === 2) {
      startDistance.current = distance(event.touches[0], event.touches[1]);
    }
  }

  function onTouchMove(event: TouchEvent) {
    if (event.touches.length !== 2 || startDistance.current === null) return;
    const current = distance(event.touches[0], event.touches[1]);
    const ratio = current / startDistance.current;
    const [a, b] = [event.touches[0], event.touches[1]];
    const midpoint = { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 };
    if (ratio >= STEP_RATIO) {
      onBeforeChange?.(midpoint);
      setColumns((value) => Math.max(min, value - 1));
      startDistance.current = current;
    } else if (ratio <= 1 / STEP_RATIO) {
      onBeforeChange?.(midpoint);
      setColumns((value) => Math.min(max, value + 1));
      startDistance.current = current;
    }
  }

  function onTouchEnd(event: TouchEvent) {
    if (event.touches.length < 2) startDistance.current = null;
  }

  const zoomBy = (steps: number) => {
    onBeforeChange?.({ clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 });
    setColumns((value) => Math.min(max, Math.max(min, value - steps)));
  };

  return { columns, zoomBy, canZoomIn: columns > min, canZoomOut: columns < max, touchHandlers: { onTouchStart, onTouchMove, onTouchEnd } };
}
