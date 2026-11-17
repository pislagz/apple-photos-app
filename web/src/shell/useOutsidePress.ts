import { useEffect, useRef, type RefObject } from "react";

// Events a finished press can still deliver after pointerdown. Swallowed in the
// capture phase so the press that closed a popup does nothing underneath it.
const FOLLOW_UPS = ["mousedown", "mouseup", "touchstart", "touchmove", "touchend", "click"] as const;
const SWALLOW_MS = 700;

function swallow(event: Event) {
  event.stopPropagation();
  if (event.cancelable) event.preventDefault();
}

// Module-level on purpose: closing the popup flips `active` and unmounts the
// hook's effect before the press's click arrives, so the guard must outlive it.
let swallowTimer = 0;
function endSwallow() {
  window.clearTimeout(swallowTimer);
  for (const type of FOLLOW_UPS) window.removeEventListener(type, swallow, true);
  window.removeEventListener("pointerdown", endSwallow, true);
  window.removeEventListener("click", endSwallow, true);
}
function swallowFollowUps() {
  endSwallow();
  for (const type of FOLLOW_UPS) window.addEventListener(type, swallow, true);
  window.addEventListener("pointerdown", endSwallow, true);
  // Registered after the swallow listeners, so it runs once the press's own
  // click (the last follow-up) has been swallowed. A new pointerdown also ends it.
  window.addEventListener("click", endSwallow, true);
  swallowTimer = window.setTimeout(endSwallow, SWALLOW_MS);
}

// Calls onOutside for a press (mouse, touch or pen) that lands outside every
// ref'd element, and keeps that press from reaching anything else. Listening
// on pointerdown in the capture phase means no backdrop z-index or touch-only
// listener decides whether it works (#502, #503).
export function useOutsidePress(
  active: boolean,
  refs: ReadonlyArray<RefObject<Element | null>>,
  onOutside: () => void,
) {
  const latest = useRef({ refs, onOutside });
  latest.current = { refs, onOutside };

  useEffect(() => {
    if (!active) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && latest.current.refs.some((ref) => ref.current?.contains(target))) return;
      swallow(event);
      swallowFollowUps();
      latest.current.onOutside();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [active]);
}
