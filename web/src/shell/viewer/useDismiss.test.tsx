import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DISMISS_MS, ZOOM_RELEASE_MS, useDismiss } from "./useDismiss";

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

  it("can dismiss again after onClose when the viewer stays mounted", () => {
    vi.useFakeTimers();
    mockMotion(false);
    const onClose = vi.fn();
    const { result } = renderHook(() => useDismiss(onClose));
    act(() => result.current.dismiss());
    act(() => {
      vi.advanceTimersByTime(DISMISS_MS);
    });
    expect(result.current.closing).toBe(false);
    act(() => result.current.dismiss());
    act(() => {
      vi.advanceTimersByTime(DISMISS_MS);
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("finishes a zoom-out close under StrictMode's mount, unmount, mount (#267)", async () => {
    mockMotion(false);
    const onClose = vi.fn();
    const zoomOut = () => ({ finished: Promise.resolve(), cancel: () => {} });
    const { result } = renderHook(() => useDismiss(onClose, zoomOut), { wrapper: StrictMode });
    await act(async () => result.current.dismiss());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the close zoom's last frame until the Viewer unmounts, so no full-screen flash (#286)", async () => {
    mockMotion(false);
    vi.useFakeTimers();
    const cancel = vi.fn();
    const zoomOut = () => ({ finished: Promise.resolve(), cancel });
    const { result, unmount } = renderHook(() => useDismiss(() => {}, zoomOut));
    await act(async () => result.current.dismiss());
    expect(cancel).not.toHaveBeenCalled();
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("releases the zoom after a short hold when the Viewer stays mounted (#286)", async () => {
    mockMotion(false);
    vi.useFakeTimers();
    const cancel = vi.fn();
    const zoomOut = () => ({ finished: Promise.resolve(), cancel });
    const { result } = renderHook(() => useDismiss(() => {}, zoomOut));
    await act(async () => result.current.dismiss());
    act(() => {
      vi.advanceTimersByTime(ZOOM_RELEASE_MS);
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
