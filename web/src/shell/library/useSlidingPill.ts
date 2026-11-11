import { useLayoutEffect, useRef } from "react";

// #206: lets a segmented control slide its selected pill. Measures the item
// with aria-selected="true" and writes --pill-x/-y/-w/-h on the container
// (CSS, `data-pill`, does the rest with transform only). The first
// measurement, and any re-measure after a resize, jump without a transition.
// Without layout (jsdom) nothing is set and the item paints its own background.
export function useSlidingPill<T extends HTMLElement>(selected: string, present = true) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box || !present) return;
    let frame = 0;

    const measure = (animate: boolean) => {
      const item = box.querySelector<HTMLElement>('[aria-selected="true"]');
      const outer = box.getBoundingClientRect();
      const inner = item?.getBoundingClientRect();
      if (!inner || inner.width === 0) {
        box.removeAttribute("data-pill");
        return;
      }
      // Snap to device pixels so the pill's edges land where a painted
      // background's would (at rest it must look identical to before).
      const dpr = window.devicePixelRatio || 1;
      const snap = (value: number) => Math.round(value * dpr) / dpr;
      const x = snap(inner.left - outer.left);
      const y = snap(inner.top - outer.top);
      box.style.setProperty("--pill-x", `${x}px`);
      box.style.setProperty("--pill-y", `${y}px`);
      box.style.setProperty("--pill-w", `${snap(inner.right - outer.left) - x}px`);
      box.style.setProperty("--pill-h", `${snap(inner.bottom - outer.top) - y}px`);
      if (animate && box.dataset.pill === "ready") return;
      box.dataset.pill = "init";
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (box.dataset.pill === "init") box.dataset.pill = "ready";
      });
    };

    // Selection change: keep "ready" so the transform transition runs.
    measure(true);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => measure(false)) : null;
    observer?.observe(box);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [selected, present]);

  return ref;
}
