import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DISMISS_MS, useDismiss } from "./useDismiss";

function mockMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce") }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useDismiss", () => {
  it("closes immediately with reduced motion", () => {
    mockMotion(true);
    const onClose = vi.fn();
    const { result } = renderHook(() => useDismiss(onClose));
    act(() => result.current.dismiss());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.closing).toBe(false);
  });

  it("plays the exit first when motion is allowed, and closes once", () => {
    vi.useFakeTimers();
    mockMotion(false);
    const onClose = vi.fn();
    const { result } = renderHook(() => useDismiss(onClose));
    act(() => result.current.dismiss());
    act(() => result.current.dismiss());
    expect(result.current.closing).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(DISMISS_MS);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
