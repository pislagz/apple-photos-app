import { type Dispatch, type RefObject, type SetStateAction, useEffect, useRef } from "react";
import { autoScrollStep, isHorizontalStart, rangeSelection, type SwipeMode } from "./swipeSelect";

const SLOP = 6;

interface Gesture {
  x: number;
  y: number;
  state: "pending" | "swiping" | "scrolling";
  mode: SwipeMode;
  startIndex: number;
  base: Set<string>;
  lastIndex: number;
}

// One-finger horizontal drag across tiles selects or deselects a run; a
// vertical start is left to the browser to scroll. Only active in select
// mode, so the normal grid and desktop are untouched.
export function useSwipeSelect(
  enabled: boolean,
  scrollRef: RefObject<HTMLElement | null>,
  order: readonly string[],
  selectedIds: ReadonlySet<string>,
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>,
) {
  const live = useRef({ order, selectedIds });
  live.current = { order, selectedIds };

  useEffect(() => {
    const el = scrollRef.current;
    if (!enabled || !el) return;
    let g: Gesture | null = null;
    let point = { x: 0, y: 0 };
    let raf = 0;

    const idAt = (x: number, y: number): string | null => {
      const hit = document.elementFromPoint(x, y)?.closest("[data-asset-id]");
      return hit?.getAttribute("data-asset-id") ?? null;
    };
    const update = () => {
      if (!g || g.state !== "swiping") return;
      const id = idAt(point.x, point.y);
      const index = id === null ? -1 : live.current.order.indexOf(id);
      if (index === -1 || index === g.lastIndex) return;
      g.lastIndex = index;
      const next = rangeSelection(live.current.order, g.startIndex, index, g.base, g.mode);
      setSelectedIds(next);
      navigator.vibrate?.(5);
    };
    const tick = () => {
      raf = 0;
      if (!g || g.state !== "swiping") return;
      const rect = el.getBoundingClientRect();
      const step = autoScrollStep(point.y, rect.top, rect.bottom);
      if (step !== 0) {
        el.scrollTop += step;
        g.lastIndex = -1; // tiles moved under a still finger
        update();
      }
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      g = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return stop();
      const t = e.touches[0];
      const id = idAt(t.clientX, t.clientY);
      const index = id === null ? -1 : live.current.order.indexOf(id);
      point = { x: t.clientX, y: t.clientY };
      g = {
        x: t.clientX,
        y: t.clientY,
        state: index === -1 ? "scrolling" : "pending",
        mode: id !== null && live.current.selectedIds.has(id) ? "deselect" : "select",
        startIndex: index,
        base: new Set(live.current.selectedIds),
        lastIndex: -1,
      };
    };
    const onMove = (e: TouchEvent) => {
      if (!g) return;
      if (e.touches.length !== 1) return stop();
      const t = e.touches[0];
      point = { x: t.clientX, y: t.clientY };
      if (g.state === "pending") {
        const dx = t.clientX - g.x;
        const dy = t.clientY - g.y;
        if (Math.hypot(dx, dy) < SLOP) return;
        g.state = isHorizontalStart(dx, dy) ? "swiping" : "scrolling";
        if (g.state === "swiping") raf = requestAnimationFrame(tick);
      }
      if (g.state !== "swiping") return;
      if (e.cancelable) e.preventDefault();
      update();
    };
    const onEnd = (e: TouchEvent) => {
      // Swallow the click a finished swipe would otherwise toggle.
      if (g?.state === "swiping" && e.cancelable) e.preventDefault();
      stop();
    };

    // Mouse and pen (#504): touch events never fire for them. A mouse drag
    // has nothing to scroll, so any direction selects; a pen keeps the
    // horizontal-start rule because its vertical drag scrolls like a finger.
    let pointerId = -1;
    let pointerType = "mouse";
    const swallowClick = () => {
      const eat = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      el.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", eat, { capture: true }), 0);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0 || !e.isPrimary) return;
      const id = idAt(e.clientX, e.clientY);
      const index = id === null ? -1 : live.current.order.indexOf(id);
      if (index === -1) return;
      pointerId = e.pointerId;
      pointerType = e.pointerType;
      point = { x: e.clientX, y: e.clientY };
      g = {
        x: e.clientX,
        y: e.clientY,
        state: "pending",
        mode: id !== null && live.current.selectedIds.has(id) ? "deselect" : "select",
        startIndex: index,
        base: new Set(live.current.selectedIds),
        lastIndex: -1,
      };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== pointerId) return;
      if ((e.buttons & 1) === 0) return stop();
      point = { x: e.clientX, y: e.clientY };
      if (g.state === "pending") {
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        if (Math.hypot(dx, dy) < SLOP) return;
        g.state = pointerType === "mouse" || isHorizontalStart(dx, dy) ? "swiping" : "scrolling";
        if (g.state === "swiping") {
          raf = requestAnimationFrame(tick);
          window.getSelection()?.removeAllRanges();
        }
      }
      if (g.state !== "swiping") return;
      e.preventDefault();
      update();
    };
    const onPointerUp = () => {
      if (g?.state === "swiping") swallowClick();
      pointerId = -1;
      stop();
    };
    const onPointerCancel = () => {
      pointerId = -1;
      stop();
    };
    // A native image drag would start before the slop is crossed.
    const noSelect = (e: Event) => {
      if (g && pointerId !== -1) e.preventDefault();
    };
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    el.addEventListener("selectstart", noSelect);
    el.addEventListener("dragstart", noSelect);

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", stop);
    return () => {
      stop();
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      el.removeEventListener("selectstart", noSelect);
      el.removeEventListener("dragstart", noSelect);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", stop);
    };
  }, [enabled, scrollRef, setSelectedIds]);
}
