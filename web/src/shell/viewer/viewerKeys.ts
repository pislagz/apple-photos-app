export type ViewerKeyAction = "close" | "prev" | "next" | null;

interface KeyLike {
  key: string;
  target: EventTarget | null;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

// Native media controls and text fields use arrows/Esc themselves (seek,
// exit fullscreen, caret movement), so the window-level viewer listener
// must not act on keys that originated there.
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest("video, audio, input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null
  );
}

export function viewerKeyAction(event: KeyLike, fullscreenElement: Element | null): ViewerKeyAction {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === "Escape") {
    if (fullscreenElement || isInteractiveTarget(event.target)) return null;
    return "close";
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    if (isInteractiveTarget(event.target)) return null;
    return event.key === "ArrowLeft" ? "prev" : "next";
  }
  return null;
}
