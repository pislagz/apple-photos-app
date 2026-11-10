import { useCallback, useEffect, useRef, useState } from "react";

export const DISMISS_MS = 180;

// No matchMedia (jsdom) counts as "no animation" so unit tests close at once.
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Viewer dismiss: play the CSS exit (`.is-closing`) and call onClose when it
// ends. With reduced motion set there is no exit, so onClose runs right away.
export function useDismiss(onClose: () => void): { closing: boolean; dismiss: () => void } {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const dismiss = useCallback(() => {
    if (closingRef.current) return;
    if (prefersReducedMotion()) {
      onCloseRef.current();
      return;
    }
    closingRef.current = true;
    setClosing(true);
    timer.current = window.setTimeout(() => onCloseRef.current(), DISMISS_MS);
  }, []);

  return { closing, dismiss };
}
