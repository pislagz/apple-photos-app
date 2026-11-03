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

// jsdom's `scrollHeight`/`scrollWidth` default to 0 (no real layout), so
// TanStack Virtual's scroll clamp (`min(offset, scrollHeight - clientHeight)`)
// forces every `scrollToOffset`/`scrollToIndex` call to 0. A large constant
// keeps that clamp a no-op in tests.
for (const prop of ["scrollHeight", "scrollWidth"]) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 1_000_000 });
}

// jsdom's `Element.scrollTo` is a documented no-op: it neither moves
// `scrollTop`/`scrollLeft` nor fires a `scroll` event. TanStack Virtual's
// `scrollToIndex` (the desktop Library's keyboard-focus scroll) calls it
// under the hood, so without this stub it would look like a no-op in every
// test that exercises that path.
Element.prototype.scrollTo = function scrollTo(this: Element, options?: ScrollToOptions | number) {
  if (typeof options === "object" && options !== null) {
    if (typeof options.top === "number") this.scrollTop = options.top;
    if (typeof options.left === "number") this.scrollLeft = options.left;
  }
  this.dispatchEvent(new Event("scroll"));
};
