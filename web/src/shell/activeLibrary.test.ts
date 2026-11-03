import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeResponse } from "../api";
import { useActiveLibrary } from "./activeLibrary";

const ME: MeResponse = {
  username: "alice",
  role: "user",
  libraries: [{ id: 1, display_name: "Family" }, { id: 2, display_name: "Travel" }],
  layout_override: null,
};

describe("useActiveLibrary", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to the first library when nothing is stored", () => {
    const { result } = renderHook(() => useActiveLibrary(ME));
    expect(result.current.activeLibraryId).toBe(1);
  });

  it("persists a switch to localStorage, keyed by username, and survives a remount", () => {
    const { result, rerender } = renderHook(() => useActiveLibrary(ME));

    act(() => result.current.setActiveLibraryId(2));
    expect(result.current.activeLibraryId).toBe(2);
    expect(window.localStorage.getItem("photos-viewer:active-library:alice")).toBe("2");

    rerender();
    expect(result.current.activeLibraryId).toBe(2);
  });

  it("reads a previously stored id on mount", () => {
    window.localStorage.setItem("photos-viewer:active-library:alice", "2");
    const { result } = renderHook(() => useActiveLibrary(ME));
    expect(result.current.activeLibraryId).toBe(2);
    expect(result.current.activeLibrary?.display_name).toBe("Travel");
  });

  it("falls back to the first library when the stored id is no longer assigned", () => {
    window.localStorage.setItem("photos-viewer:active-library:alice", "99");
    const { result } = renderHook(() => useActiveLibrary(ME));
    expect(result.current.activeLibraryId).toBe(1);
  });

  it("has no active library before `me` resolves", () => {
    const { result } = renderHook(() => useActiveLibrary(null));
    expect(result.current.activeLibraryId).toBeUndefined();
    expect(result.current.activeLibrary).toBeUndefined();
  });
});
