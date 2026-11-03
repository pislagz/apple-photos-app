import "@testing-library/jest-dom/vitest";

// jsdom does no real layout: `getBoundingClientRect` is always zero, and
// jsdom's own built-in `ResizeObserver` never fires its callback. TanStack
// Virtual (the mobile Library grid) reads the container's size from that
// callback, not a direct `getBoundingClientRect` call, so this stub has to
// invoke it once with the (fixed) rect for virtualized-list tests to see
// non-zero rows. It replaces jsdom's inert built-in, not just a missing one.
class ResizeObserverStub {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    const rect = target.getBoundingClientRect();
    const size = { inlineSize: rect.width, blockSize: rect.height } as ResizeObserverSize;
    const entry = {
      target,
      contentRect: rect,
      borderBoxSize: [size],
      contentBoxSize: [size],
      devicePixelContentBoxSize: [size],
    } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }

  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

Element.prototype.getBoundingClientRect = () =>
  ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;

for (const prop of ["clientWidth", "offsetWidth"]) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 800 });
}
for (const prop of ["clientHeight", "offsetHeight"]) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 600 });
}
