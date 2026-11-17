// #458: on desktop the admin content column is its own scroller and the
// document no longer scrolls. With focus on the page itself or on a sidebar
// button, the browser sends PgDn / Space / arrows to the document, so they
// would do nothing. This hands those keys to the content column. Keys pressed
// inside the column, in a field, or while a dialog is open keep the browser's
// own behaviour.

const LINE = 40;

export interface ScrollBox {
  top: number;
  page: number;
  max: number;
}

/** New scrollTop for a scroll key, or null when the key does not scroll. */
export function scrollKeyTop(key: string, shift: boolean, box: ScrollBox): number | null {
  const step = Math.max(LINE, box.page - LINE);
  let next: number;
  switch (key) {
    case "ArrowDown":
      next = box.top + LINE;
      break;
    case "ArrowUp":
      next = box.top - LINE;
      break;
    case "PageDown":
      next = box.top + step;
      break;
    case "PageUp":
      next = box.top - step;
      break;
    case " ":
      next = box.top + (shift ? -step : step);
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = box.max;
      break;
    default:
      return null;
  }
  return Math.min(box.max, Math.max(0, next));
}

/** Scroll `scroller` for a keydown the browser would send to the document. */
export function routeScrollKey(event: KeyboardEvent, scroller: HTMLElement | null): boolean {
  if (scroller === null || event.defaultPrevented) return false;
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  // Only the desktop layout makes the column a scroller; phones scroll the page.
  if (getComputedStyle(scroller).overflowY !== "auto") return false;
  if (document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]')) return false;
  const target = event.target;
  const onPage = target === document.body || target === document.documentElement || target === document;
  if (!onPage) {
    if (!(target instanceof Element)) return false;
    if (scroller.contains(target)) return false;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return false;
    // Space on a sidebar button presses it.
    if (event.key === " ") return false;
  }
  const top = scrollKeyTop(event.key, event.shiftKey, {
    top: scroller.scrollTop,
    page: scroller.clientHeight,
    max: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
  });
  if (top === null) return false;
  event.preventDefault();
  scroller.scrollTop = top;
  return true;
}
