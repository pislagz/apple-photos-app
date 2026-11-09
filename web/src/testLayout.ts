import { afterEach, beforeEach } from "vitest";

// Opt-in fake layout for tests that need a sized viewport (the virtualized
// Library grids and filmstrip). jsdom reports every box as 0x0, so TanStack
// Virtual would render nothing. Scoped per test file via beforeEach/afterEach
// instead of faking every element in every test (#88).
export interface FakeLayout {
  width?: number;
  height?: number;
  // jsdom's scrollHeight/scrollWidth are 0, which makes TanStack Virtual's
  // scroll clamp (`min(offset, scrollHeight - clientHeight)`) force every
  // scrollTo to 0.
  scrollSize?: number;
}

export function useFakeLayout({ width = 800, height = 600, scrollSize = 1_000_000 }: FakeLayout = {}) {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let originalRect: typeof Element.prototype.getBoundingClientRect;

  function define(prop: string, value: number) {
    originals.set(prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop));
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
  }

  beforeEach(() => {
    originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () =>
      ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} }) as DOMRect;
    define("clientWidth", width);
    define("offsetWidth", width);
    define("clientHeight", height);
    define("offsetHeight", height);
    define("scrollWidth", scrollSize);
    define("scrollHeight", scrollSize);
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    for (const [prop, descriptor] of originals) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, prop, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    }
    originals.clear();
  });
}
