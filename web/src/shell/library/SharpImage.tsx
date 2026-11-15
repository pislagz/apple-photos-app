import { useEffect, useRef, useState } from "react";

// #433: a higher-resolution copy laid over a grid tile that is much bigger
// than its thumbnail (1 per row). It exists only while the tile is within
// half a viewport of the scroller, after a short settle so a fast flick
// loads nothing; leaving that margin unmounts it and the thumbnail below
// shows again. It is absolutely positioned inside the tile, so the swap
// never moves layout, and it fades in once decoded.
export const SHARP_MARGIN = "50% 0px";
export const SHARP_SETTLE_MS = 150;

function scrollParent(element: HTMLElement): Element | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
}

export default function SharpImage({ src, fit }: { src: string; fit: "cover" | "contain" }) {
  const anchor = useRef<HTMLSpanElement | null>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  const [active, setActive] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = anchor.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => setNear(entries[entries.length - 1].isIntersecting), {
      root: scrollParent(el),
      rootMargin: SHARP_MARGIN,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!near) {
      setActive(false);
      setLoaded(false);
      return;
    }
    const timer = setTimeout(() => setActive(true), SHARP_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [near]);

  return (
    <span ref={anchor} className="mobile-library__sharp" aria-hidden="true">
      {active && (
        <img
          src={src}
          alt=""
          draggable={false}
          className="fade-image mobile-library__sharp-image"
          data-loaded={loaded}
          data-sharp="true"
          style={{ objectFit: fit }}
          onLoad={() => setLoaded(true)}
        />
      )}
    </span>
  );
}
