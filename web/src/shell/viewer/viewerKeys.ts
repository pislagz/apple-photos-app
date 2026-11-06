export type ViewerKeyAction = "close" | "prev" | "next" | null;

interface KeyLike {
  key: string;
  target: EventTarget | null;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

const TEXT_FIELDS = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const MEDIA = "video, audio";

function closestMatch(target: EventTarget | null, selector: string): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(selector) !== null;
}

// Arrows: native media controls seek with them and text fields move the
// caret, so the window-level viewer listener must not act on arrows that
// originated there.
//
// Esc: in fullscreen the browser uses it to exit fullscreen, and in text
// fields it belongs to the field. Media controls do not use Esc outside
// fullscreen, and clicking a video (e.g. to pause) focuses it, so Esc from a
// focused video still closes the viewer.
export function viewerKeyAction(event: KeyLike, fullscreenElement: Element | null): ViewerKeyAction {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === "Escape") {
    if (fullscreenElement || closestMatch(event.target, TEXT_FIELDS)) return null;
    return "close";
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    if (closestMatch(event.target, `${MEDIA}, ${TEXT_FIELDS}`)) return null;
    return event.key === "ArrowLeft" ? "prev" : "next";
  }
  return null;
}
