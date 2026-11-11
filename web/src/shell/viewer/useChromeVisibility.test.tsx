import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHROME_AUTOHIDE_MS, useChromeVisibility } from "./useChromeVisibility";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useChromeVisibility", () => {
  it("toggles on demand and never auto-hides when no video plays", () => {
    const { result } = renderHook(() => useChromeVisibility(false));
    act(() => vi.advanceTimersByTime(CHROME_AUTOHIDE_MS * 4));
    expect(result.current.hidden).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.hidden).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.hidden).toBe(false);
  });

  it("hides 2.5 s into playback, and comes back on pause", () => {
    const { result, rerender } = renderHook(({ playing }) => useChromeVisibility(playing), {
      initialProps: { playing: true },
    });
    act(() => vi.advanceTimersByTime(CHROME_AUTOHIDE_MS - 1));
    expect(result.current.hidden).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.hidden).toBe(true);
    rerender({ playing: false });
    expect(result.current.hidden).toBe(false);
  });

  it("restarts the idle timer on reveal and on a tap that brings the bars back", () => {
    const { result } = renderHook(() => useChromeVisibility(true));
    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.reveal());
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.hidden).toBe(false);
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.hidden).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.hidden).toBe(false);
    act(() => vi.advanceTimersByTime(CHROME_AUTOHIDE_MS));
    expect(result.current.hidden).toBe(true);
  });
});
