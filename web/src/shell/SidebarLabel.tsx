import { useEffect, useRef, useState } from "react";

// #470: a sidebar row's title. One line, cut off with an ellipsis. Like the
// Photos for Mac sidebar, resting the pointer on a title that is cut off shows
// the full name in a small tooltip; a title that fits shows nothing. The
// tooltip is a portal so the sidebar's overflow does not clip it. The text
// stays in the row, so the row's accessible name is still the full title.
export const SIDEBAR_TOOLTIP_DELAY_MS = 600;
const EDGE = 8;

// #474: one tooltip element for the whole sidebar, created on demand and
// reused, so two can never be on screen at once (rows, folders and nested
// albums share it). Each label closes it when the pointer is no longer over
// that label, so a missed mouseleave cannot leave it behind. The rows carry no
// title attribute and no SVG <title>, so the browser adds no native tooltip.
let closeActive: (() => void) | null = null;
let tipEl: HTMLDivElement | null = null;

function tooltipEl(): HTMLDivElement {
  if (!tipEl || !tipEl.isConnected) {
    document.querySelectorAll(".sidebar-tooltip").forEach((el) => el.remove());
    tipEl = document.createElement("div");
    tipEl.setAttribute("role", "tooltip");
    tipEl.className = "sidebar-tooltip";
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function showTip(text: string, x: number, y: number) {
  const el = tooltipEl();
  el.textContent = text;
  el.style.top = `${y}px`;
  el.style.left = "0px";
  const max = window.innerWidth - el.offsetWidth - EDGE;
  el.style.left = `${Math.max(EDGE, Math.min(x, max))}px`;
}

function hideTip() {
  document.querySelectorAll(".sidebar-tooltip").forEach((el) => el.remove());
  tipEl = null;
}

export function isTruncated(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth;
}

export default function SidebarLabel({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const pointerX = useRef(0);
  const [open, setOpen] = useState(false);

  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setOpen(false);
    if (closeActive === stable) {
      closeActive = null;
      hideTip();
    }
  };
  const hideRef = useRef(hide);
  hideRef.current = hide;

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (closeActive === stable) {
        closeActive = null;
        hideTip();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const stable = useRef(() => hideRef.current()).current;

  // Scrolling, a key press or leaving the window moves on from the row.
  useEffect(() => {
    if (!open) return;
    const off = () => hideRef.current();
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
  }, [open]);

  return (
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
          closeActive = stable;
          showTip(text, pointerX.current, el.getBoundingClientRect().bottom + 6);
          setOpen(true);
        }, SIDEBAR_TOOLTIP_DELAY_MS);
      }}
      onMouseMove={(event) => {
        pointerX.current = event.clientX;
      }}
      onMouseLeave={() => hideRef.current()}
      onMouseDown={() => hideRef.current()}
    >
      {text}
    </span>
  );
}
