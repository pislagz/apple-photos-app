// Photos-style keyboard shortcuts (#217). Cmd on macOS, Ctrl elsewhere.
export type ShortcutAction = "zoomIn" | "zoomOut" | "back" | "info" | "up" | "selectAll" | null;

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
}

// Never fire while the user is typing; a focused button/link keeps its own
// Space and Enter.
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export function isControlTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (isTypingTarget(el) || !!el.closest?.("button, a, summary, video, audio, [role=slider]"));
}

export function shortcutAction(event: KeyLike): ShortcutAction {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  switch (event.key) {
    case "+":
    case "=":
      return "zoomIn";
    case "-":
    case "_":
      return "zoomOut";
    case "[":
      return "back";
    case "i":
    case "I":
      return "info";
    case "ArrowUp":
      return "up";
    case "a":
    case "A":
      return "selectAll";
    default:
      return null;
  }
}

// #366: the page is an app, not a document. Cmd/Ctrl+A never starts the
// browser's own text selection except in fields and in text marked
// data-selectable-text (the Info panel); views that own a selection model
// handle the same key themselves.
export function blocksBrowserSelectAll(event: KeyLike & { target: EventTarget | null }): boolean {
  if (shortcutAction(event) !== "selectAll") return false;
  if (isTypingTarget(event.target)) return false;
  const el = event.target as HTMLElement | null;
  return !el?.closest?.("[data-selectable-text]");
}

export function installSelectAllGuard(target: Window = window): () => void {
  function onKeyDown(event: KeyboardEvent) {
    if (blocksBrowserSelectAll(event)) event.preventDefault();
  }
  // Capture, so it runs before any view handler and nothing can miss it.
  target.addEventListener("keydown", onKeyDown, true);
  return () => target.removeEventListener("keydown", onKeyDown, true);
}
