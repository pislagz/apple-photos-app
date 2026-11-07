import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../../testHelpers";
import { useLibrarySummary } from "./useLibrarySummary";

afterEach(() => {
  vi.unstubAllGlobals();
});

const SUMMARY = { years: [], months: [], days: [] };

describe("useLibrarySummary", () => {
  it("exposes error on failure and recovers on retry", async () => {
    let fail = true;
    mockFetch(() => (fail ? new Response("boom", { status: 500 }) : SUMMARY));
    const { result } = renderHook(() => useLibrarySummary(1));

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.summary).toBeNull();

    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.summary).not.toBeNull());
    expect(result.current.error).toBe(false);
  });

  it("ignores a stale failure after the library changes", async () => {
    mockFetch((url) => (url.includes("/libraries/1/") ? new Response("boom", { status: 500 }) : SUMMARY));
    const { result, rerender } = renderHook(({ id }) => useLibrarySummary(id), { initialProps: { id: 1 } });
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.summary).not.toBeNull());
    expect(result.current.error).toBe(false);
  });
});
