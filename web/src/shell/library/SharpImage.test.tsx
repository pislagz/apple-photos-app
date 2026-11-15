import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SharpImage, { SHARP_SETTLE_MS } from "./SharpImage";

type Callback = (entries: { isIntersecting: boolean }[]) => void;
let callback: Callback = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: Callback) {
        callback = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SharpImage (#433)", () => {
  it("loads only after the tile is near and settled, and drops when it leaves", () => {
    const { container } = render(<SharpImage src="/t?size=preview" fit="cover" />);
    expect(container.querySelector("img")).toBeNull();
    act(() => callback([{ isIntersecting: true }]));
    act(() => void vi.advanceTimersByTime(SHARP_SETTLE_MS - 10));
    expect(container.querySelector("img")).toBeNull(); // a flick past loads nothing
    act(() => void vi.advanceTimersByTime(20));
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/t?size=preview");
    expect(img.dataset.loaded).toBe("false");
    act(() => callback([{ isIntersecting: false }]));
    expect(container.querySelector("img")).toBeNull();
  });
});
