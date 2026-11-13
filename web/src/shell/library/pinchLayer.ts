// DOM side of the pinch (#213): the grid layer is scaled in place under the
// fingers with a transform, and layout only changes once the fingers lift.

export function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Reads a duration token (e.g. --dur-zoom) so JS timers match the CSS.
export function tokenMs(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith("ms") ? value : raw.endsWith("s") ? value * 1000 : fallback;
}

// `origin` is in the layer's own coordinates (scroll content space).
export function scaleLayer(layer: HTMLElement, scale: number, origin: { x: number; y: number }) {
  layer.style.transformOrigin = `${origin.x}px ${origin.y}px`;
  layer.style.transform = scale === 1 ? "" : `scale(${scale})`;
  layer.style.willChange = scale === 1 ? "" : "transform";
}

export function resetLayer(layer: HTMLElement) {
  layer.style.transform = "";
  layer.style.willChange = "";
}

// Not enough movement for a new level: ease back to 1 (200 ms, --dur-chrome).
export function snapBack(layer: HTMLElement) {
  if (reducedMotion()) {
    resetLayer(layer);
    return;
  }
  layer.classList.add("is-snapping");
  layer.style.transform = "scale(1)";
  window.setTimeout(() => {
    layer.classList.remove("is-snapping");
    resetLayer(layer);
  }, tokenMs("--dur-chrome", 200));
}

// A level was chosen: park a copy of the scaled layer on top of the scroller
// and fade it away (growing a little more) while the re-laid-out grid shows
// through. The copy is a few visible rows, since the grid is virtualised.
export function fadeGhost(layer: HTMLElement, scroller: HTMLElement, scale: number, zoomIn: boolean) {
  const host = scroller.parentElement;
  if (!host || reducedMotion()) return;
  const hostBox = host.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = "mobile-library__zoom-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.cssText = `left:${box.left - hostBox.left}px;top:${box.top - hostBox.top}px;width:${box.width}px;height:${box.height}px`;
  const copy = layer.cloneNode(true) as HTMLElement;
  copy.removeAttribute("data-testid");
  copy.querySelectorAll("[data-testid]").forEach((node) => node.removeAttribute("data-testid"));
  copy.classList.add("mobile-library__zoom-ghost-layer");
  copy.style.top = `${-scroller.scrollTop}px`;
  copy.style.transform = `scale(${scale})`;
  ghost.appendChild(copy);
  host.appendChild(ghost);
  const done = () => ghost.remove();
  requestAnimationFrame(() => {
    ghost.classList.add("is-leaving");
    copy.style.transform = `scale(${scale * (zoomIn ? 1.25 : 0.8)})`;
  });
  window.setTimeout(done, tokenMs("--dur-zoom", 280) + 80);
}
