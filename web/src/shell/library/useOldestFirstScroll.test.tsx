import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AssetListItem } from "../../api";
import { buildRows, type LibraryRow } from "./rows";
import { compensatedScrollTop, useLandOnPeriod, useOldestFirstScroll, useViewerIndex } from "./useOldestFirstScroll";
import { act } from "@testing-library/react";

function item(id: string, day: number): AssetListItem {
  return {
    id,
    filename: `${id}.jpg`,
    date: `2024-05-${String(day).padStart(2, "0")}T10:00:00`,
    is_video: false,
    is_live_photo: false,
    favorite: false,
    width: 1,
    height: 1,
    duration: null,
  };
}

const ROW = 100;
const rowSize = (_row: LibraryRow) => ROW;
// Oldest first; p1 is the oldest.
const all = Array.from({ length: 12 }, (_, i) => item(`p${i + 1}`, i + 1));

describe("compensatedScrollTop (#224)", () => {
  it("moves the offset by the height of the rows added on top, including the part scrolled into the row", () => {
    const before = buildRows(all.slice(6), "all", 3, true); // p7..p12 -> 2 rows
    const after = buildRows(all, "all", 3, true); // 4 rows
    expect(compensatedScrollTop(130, before, after, rowSize)).toBe(330);
    expect(compensatedScrollTop(0, before, after, rowSize)).toBe(200);
  });

  it("leaves the offset alone when the anchor row is not found", () => {
    expect(compensatedScrollTop(50, [], buildRows(all, "all", 3, true), rowSize)).toBe(50);
  });
});

function scroller(height = 300) {
  const element = document.createElement("div");
  let total = 0;
  Object.defineProperty(element, "scrollHeight", { get: () => total });
  Object.defineProperty(element, "clientHeight", { get: () => height });
  return { element, setTotal: (value: number) => (total = value) };
}

describe("useOldestFirstScroll (#224)", () => {
  it("scrolls to the end once rows exist, then keeps the view in place when older rows arrive", () => {
    const { element, setTotal } = scroller();
    const ref = { current: element };
    const initial = buildRows(all.slice(6), "all", 3, true);
    setTotal(initial.length * ROW);
    const { rerender } = renderHook(({ rows }) => useOldestFirstScroll({ scrollRef: ref, rows, rowSize, ready: true }), {
      initialProps: { rows: initial },
    });
    expect(element.scrollTop).toBe(200);

    // The user scrolls up a little, then an older page of two rows is added on top.
    element.scrollTop = 40;
    const more = buildRows(all, "all", 3, true);
    setTotal(more.length * ROW);
    rerender({ rows: more });
    expect(element.scrollTop).toBe(240);
  });

  it("does not move the offset when only the columns change", () => {
    const { element, setTotal } = scroller();
    const ref = { current: element };
    const three = buildRows(all, "all", 3, true);
    setTotal(three.length * ROW);
    const { rerender } = renderHook(({ rows }) => useOldestFirstScroll({ scrollRef: ref, rows, rowSize, ready: true }), {
      initialProps: { rows: three },
    });
    element.scrollTop = 120;
    rerender({ rows: buildRows(all, "all", 4, true) });
    expect(element.scrollTop).toBe(120);
  });

  it("goes back to the end after the rows were emptied (a new filter)", () => {
    const { element, setTotal } = scroller();
    const ref = { current: element };
    const rows = buildRows(all, "all", 3, true);
    setTotal(rows.length * ROW);
    const { rerender } = renderHook(({ rows }) => useOldestFirstScroll({ scrollRef: ref, rows, rowSize, ready: true }), {
      initialProps: { rows },
    });
    element.scrollTop = 0;
    rerender({ rows: [] });
    rerender({ rows });
    expect(element.scrollTop).toBe(rows.length * ROW);
  });

  it("scrollToEnd glides when asked and jumps otherwise", () => {
    const { element, setTotal } = scroller();
    setTotal(900);
    const calls: unknown[] = [];
    element.scrollTo = ((options: unknown) => calls.push(options)) as typeof element.scrollTo;
    const { result } = renderHook(() => useOldestFirstScroll({ scrollRef: { current: element }, rows: [], rowSize, ready: false }));
    result.current.scrollToEnd(true);
    expect(calls).toEqual([{ top: 900, behavior: "smooth" }]);
    result.current.scrollToEnd();
    expect(element.scrollTop).toBe(900);
  });
});

describe("useViewerIndex (#224)", () => {
  it("follows the photo when older photos are added in front of it", () => {
    const { result, rerender } = renderHook(({ items }) => useViewerIndex(items), { initialProps: { items: all.slice(6) } });
    act(() => result.current[1](1));
    expect(result.current[0]).toBe(1);
    rerender({ items: all });
    expect(result.current[0]).toBe(7);
    act(() => result.current[1](null));
    expect(result.current[0]).toBeNull();
  });
});

describe("useLandOnPeriod (#224)", () => {
  it("keeps loading older pages until the list reaches back past the period, then scrolls to it", () => {
    const calls: string[] = [];
    const run = (items: AssetListItem[], done: boolean) =>
      renderHook(() =>
        useLandOnPeriod({
          key: "2024-05-04",
          active: true,
          items,
          rows: buildRows(items, "all", 3, true),
          loading: false,
          done,
          loadMore: () => calls.push("load"),
          scrollToRow: (index) => calls.push(`row:${index}`),
          onLanded: () => calls.push("landed"),
        }),
      );
    // Oldest loaded is May 7: May 4 is further back, so fetch more.
    run(all.slice(6), false);
    expect(calls).toEqual(["load"]);
    // May 1 is loaded: May 4 is inside the list. Rows from the end: [p1],[p2..p4],... -> its first photo p4 is in row 1.
    calls.length = 0;
    run(all, false);
    expect(calls).toEqual(["row:1", "landed"]);
  });
});
