import "@testing-library/jest-dom/vitest";

// jsdom has no `ResizeObserver`. TanStack
// Virtual (the mobile Library grid) reads the container's size from that
// callback, not a direct `getBoundingClientRect` call, so this stub has to
// invoke it once with the (fixed) rect for virtualized-list tests to see
// non-zero rows (zero unless the test opted into `useFakeLayout`).
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

// jsdom does no layout, but this file deliberately does NOT fake any (#88): a
// global 800x600 box for every element let real layout bugs pass CI, e.g. a
// scroll container with no height limit still "virtualized" fine. Tests that
// need a sized viewport opt in with `useFakeLayout()` from `testLayout.ts`.

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
