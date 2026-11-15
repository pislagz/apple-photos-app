import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetHide, AssetListItem } from "../../api";
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

const NO_HIDE: AssetHide[] = [];

describe("useLibraryAssets oldest first (#224)", () => {
  // The server pages newest first; these four assets are a4 (newest) .. a1.
  function pagedServer() {
    const all = ["a4", "a3", "a2", "a1"].map(makeItem);
    return mockFetch((url) => {
      const cursor = new URL(url, "http://x").searchParams.get("cursor");
      const start = cursor ? all.findIndex((item) => item.id === cursor) + 1 : 0;
      const page = all.slice(start, start + 2);
      return { items: page, next_cursor: start + 2 < all.length ? page[page.length - 1].id : null };
    });
  }

  it("lists the newest page first requested, oldest on top, and prepends each older page", async () => {
    pagedServer();
    const { result } = renderHook(() => useLibraryAssets(1, null, "all", null, NO_HIDE, true));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(["a3", "a4"]));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(["a1", "a2", "a3", "a4"]));
    expect(result.current.done).toBe(true);
  });

  it("keeps the newest-first order when not oldest first", async () => {
    pagedServer();
    const { result } = renderHook(() => useLibraryAssets(1));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(["a4", "a3"]));
  });

  it("loadAll returns the whole library oldest first", async () => {
    pagedServer();
    const { result } = renderHook(() => useLibraryAssets(1, null, "all", null, NO_HIDE, true));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    let all: AssetListItem[] = [];
    await act(async () => {
      all = await result.current.loadAll();
    });
    expect(all.map((item) => item.id)).toEqual(["a1", "a2", "a3", "a4"]);
  });
});
