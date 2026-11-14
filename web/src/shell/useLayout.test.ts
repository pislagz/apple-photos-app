import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLayout } from "./useLayout";

function setViewport(width: number, { finePointer = true, standalone = false } = {}) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: query === "(pointer: fine)" ? finePointer : query === "(display-mode: standalone)" ? standalone : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

describe("useLayout", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("detects desktop on a wide screen with a fine pointer", () => {
    setViewport(1200, { finePointer: true });
    const { result } = renderHook(() => useLayout());
    expect(result.current.layout).toBe("desktop");
  });

  it("detects mobile on a narrow screen", () => {
    setViewport(400, { finePointer: true });
    const { result } = renderHook(() => useLayout());
    expect(result.current.layout).toBe("mobile");
  });

  it("detects mobile on a wide screen with a coarse (touch) pointer", () => {
    setViewport(1200, { finePointer: false });
    const { result } = renderHook(() => useLayout());
    expect(result.current.layout).toBe("mobile");
  });

  it("detects desktop for a standalone PWA in a wide fine-pointer window", () => {
    setViewport(1200, { finePointer: true, standalone: true });
    const { result } = renderHook(() => useLayout());
    expect(result.current.layout).toBe("desktop");
  });

  it("detects mobile for a standalone PWA on a touch phone", () => {
    setViewport(390, { finePointer: false, standalone: true });
    const { result } = renderHook(() => useLayout());
    expect(result.current.layout).toBe("mobile");
  });

  it("detects mobile for a narrow standalone PWA window", () => {
    setViewport(400, { finePointer: true, standalone: true });
    const { result } = renderHook(() => useLayout());
    expect(result.current.layout).toBe("mobile");
  });

  it("switches layout when the viewport resizes", () => {
    setViewport(1200, { finePointer: true });
    const { result } = renderHook(() => useLayout());
    expect(result.current.layout).toBe("desktop");

    act(() => {
      setViewport(400, { finePointer: true });
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current.layout).toBe("mobile");
  });

  it("ignores and clears a stored manual layout so a phone gets the automatic layout (#386)", () => {
    window.localStorage.setItem("photos-viewer:layout-override", "desktop");
    setViewport(400, { finePointer: false });
    const { result } = renderHook(() => useLayout());
    expect(result.current.layout).toBe("mobile");
    expect(window.localStorage.getItem("photos-viewer:layout-override")).toBeNull();
  });
});
