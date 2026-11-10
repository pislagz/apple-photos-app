import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetListItem } from "../../api";
import { mockFetch } from "../../testHelpers";
import { useLibraryAssets } from "./useLibraryAssets";

function makeItem(id: string): AssetListItem {
  return {
    id,
    filename: `${id}.jpg`,
    date: "2024-05-10T10:00:00",
    is_video: false,
    is_live_photo: false,
    favorite: false,
    width: 100,
    height: 100,
    duration: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useLibraryAssets (#147)", () => {
  it("keeps loaded items when a later page fails, and retry re-requests that page", async () => {
    let failSecond = true;
    mockFetch((url) => {
      if (!url.includes("cursor=")) return { items: [makeItem("a1")], next_cursor: "c1" };
      return failSecond ? new Response("boom", { status: 500 }) : { items: [makeItem("a2")], next_cursor: null };
    });
    const { result } = renderHook(() => useLibraryAssets(1));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.items.map((item) => item.id)).toEqual(["a1"]);
    expect(result.current.done).toBe(true);

    failSecond = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(["a1", "a2"]));
    expect(result.current.error).toBe(false);
    expect(result.current.done).toBe(true);
  });

  it("retry re-requests the same cursor", async () => {
    const urls: string[] = [];
    let fail = true;
    mockFetch((url) => {
      urls.push(url);
      if (!url.includes("cursor=")) return { items: [makeItem("a1")], next_cursor: "c1" };
      return fail ? new Response("boom", { status: 500 }) : { items: [makeItem("a2")], next_cursor: null };
    });
    const { result } = renderHook(() => useLibraryAssets(1));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBe(true));
    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    const cursored = urls.filter((url) => url.includes("cursor="));
    expect(cursored).toHaveLength(2);
    expect(cursored[1]).toBe(cursored[0]);
  });

  it("clears the error when the library changes", async () => {
    mockFetch((url) =>
      url.includes("/libraries/1/") ? new Response("boom", { status: 500 }) : { items: [makeItem("b1")], next_cursor: null },
    );
    const { result, rerender } = renderHook(({ id }) => useLibraryAssets(id), { initialProps: { id: 1 } });
    await waitFor(() => expect(result.current.error).toBe(true));
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.error).toBe(false);
  });
});
