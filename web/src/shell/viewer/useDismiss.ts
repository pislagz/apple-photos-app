import type { ZoomOut } from "./useZoomTransition";
import { useCallback, useEffect, useRef, useState } from "react";

export const DISMISS_MS = 150; // matches --dur-fade-open (tokens.css)

// No matchMedia (jsdom) counts as "no animation" so unit tests close at once.
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Viewer dismiss: play the CSS exit (`.is-closing`) and call onClose when it
// ends. With reduced motion set there is no exit, so onClose runs right away.
//
// #220: `zoomOut` (when given) is tried first. It zooms the photo back into its
// tile and returns a handle to wait on, or null when there is no tile to land
// on; null falls through to the fade above. `from` is whatever the caller
// passes to dismiss (the swipe-down's last frame).
export function useDismiss<From = undefined>(
  onClose: () => void,
  zoomOut?: (from?: From) => ZoomOut | null,
): { closing: boolean; dismiss: (from?: From) => void } {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const zoomOutRef = useRef(zoomOut);
  zoomOutRef.current = zoomOut;

  const alive = useRef(true);
  const zoomRef = useRef<ZoomOut | null>(null);
  useEffect(() => {
    // StrictMode mounts, cleans up and mounts again; without this the second
    // mount stays "dead" and every zoom-out close bails in finish().
    alive.current = true;
    return () => {
      alive.current = false;
      // Unmounted mid-zoom (Back, route change): finish() will bail, so give
      // the tile back and clear the zoom marker here.
      zoomRef.current?.cancel();
      zoomRef.current = null;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const dismiss = useCallback((from?: From) => {
    if (closingRef.current) return;
    if (prefersReducedMotion()) {
      onCloseRef.current();
      return;
    }
    const zoom = zoomOutRef.current?.(from);
    if (zoom) {
      closingRef.current = true;
      zoomRef.current = zoom;
      const finish = () => {
        if (!alive.current) return;
        onCloseRef.current();
        zoom.cancel();
        zoomRef.current = null;
        closingRef.current = false;
      };
      zoom.finished.then(finish, finish);
      return;
    }
    closingRef.current = true;
    setClosing(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onCloseRef.current();
      // A viewer that stays mounted after onClose can be dismissed again.
      closingRef.current = false;
      setClosing(false);
    }, DISMISS_MS);
  }, []);

  return { closing, dismiss };
}
