import { type RefObject, useEffect, useRef } from "react";

// D59: while an overlay (the Viewer, the iPhone Info sheet, a modal) is open,
// keyboard focus must not reach what it covers. Everything outside the
// overlay's own branch of the DOM gets `inert`: its siblings, then its
// parent's siblings, up to <body>. That works wherever the overlay is rendered
// (inside the grid, a portal) without wiring each background component.
// Elements that were already inert stay as they were; only what this call
// marked is released.
export function makeOutsideInert(root: HTMLElement): () => void {
  const marked: Element[] = [];
  let node: HTMLElement = root;
  while (node.parentElement && node !== document.body) {
    const parent: HTMLElement = node.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || sibling.hasAttribute("inert")) continue;
      sibling.setAttribute("inert", "");
      marked.push(sibling);
    }
    node = parent;
  }
  return () => {
    for (const element of marked) element.removeAttribute("inert");
  };
}

interface FocusScopeOptions {
  // Scope only while true (the Info sheet mounts and unmounts under it).
  active?: boolean;
  // Where focus goes first. Default: the root itself if focus is not inside.
  initialFocus?: () => HTMLElement | null;
  // Where focus goes on release. Default: the element focused when it opened.
  restoreTo?: () => HTMLElement | null;
}

export function useFocusScope(ref: RefObject<HTMLElement | null>, options: FocusScopeOptions = {}) {
  const { active = true } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = makeOutsideInert(root);
    const first = optionsRef.current.initialFocus?.();
    if (first) first.focus({ preventScroll: true });
    else if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
    return () => {
      release();
      const target = optionsRef.current.restoreTo?.() ?? (opener?.isConnected ? opener : null);
      target?.focus({ preventScroll: true });
    };
  }, [active, ref]);
}

// The grid cell (or Hidden thumbnail) the overlay was opened from.
export function thumbnailFor(assetId: string | undefined): HTMLElement | null {
  if (!assetId) return null;
  return document.querySelector<HTMLElement>(`[data-asset-id="${CSS.escape(assetId)}"]`);
}
