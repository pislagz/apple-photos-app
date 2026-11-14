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
