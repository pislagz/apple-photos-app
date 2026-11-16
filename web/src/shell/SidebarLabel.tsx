import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// #470: a sidebar row's title. One line, cut off with an ellipsis. Like the
// Photos for Mac sidebar, resting the pointer on a title that is cut off shows
// the full name in a small tooltip; a title that fits shows nothing. The
// tooltip is a portal so the sidebar's overflow does not clip it. The text
// stays in the row, so the row's accessible name is still the full title.
export const SIDEBAR_TOOLTIP_DELAY_MS = 600;
const EDGE = 8;

// #474: only one sidebar tooltip may exist at a time, whatever the number of
// rows (folders hold albums with the same name, so two rows can read alike).
// Showing one closes the one before it; each tooltip also closes as soon as
// the pointer is no longer over its own title, so a missed mouseleave (touch
// compatibility events, a row re-rendered under the pointer) cannot leave one
// behind.
let closeActive: (() => void) | null = null;

export function isTruncated(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth;
}

export default function SidebarLabel({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const pointerX = useRef(0);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setTip(null);
  };

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (closeActive === hide) closeActive = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Scrolling, a key press or leaving the window moves on from the row.
  useEffect(() => {
    if (!tip) return;
    const off = () => setTip(null);
    const away = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) off();
    };
    document.addEventListener("mouseover", away, true);
    window.addEventListener("scroll", off, true);
    window.addEventListener("keydown", off, true);
    window.addEventListener("blur", off);
    return () => {
      document.removeEventListener("mouseover", away, true);
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("keydown", off, true);
      window.removeEventListener("blur", off);
    };
  }, [tip]);

  // Keep the tooltip inside the window.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!tip || !el) return;
    const max = window.innerWidth - el.offsetWidth - EDGE;
    el.style.left = `${Math.max(EDGE, Math.min(tip.x, max))}px`;
  }, [tip]);

  return (
    <>
      <span
        ref={ref}
        className="sidebar__label"
        onMouseEnter={(event) => {
          // Touch taps fire compatibility mouse events with no mouseleave.
          if ((event.nativeEvent as PointerEvent).pointerType === "touch") return;
          pointerX.current = event.clientX;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            timer.current = undefined;
            const el = ref.current;
            if (!el || !isTruncated(el)) return;
            closeActive?.();
            closeActive = hide;
            setTip({ x: pointerX.current, y: el.getBoundingClientRect().bottom + 6 });
          }, SIDEBAR_TOOLTIP_DELAY_MS);
        }}
        onMouseMove={(event) => {
          pointerX.current = event.clientX;
        }}
        onMouseLeave={hide}
        onMouseDown={hide}
      >
        {text}
      </span>
      {tip &&
        createPortal(
          <div ref={tipRef} role="tooltip" className="sidebar-tooltip" style={{ left: tip.x, top: tip.y }}>
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
