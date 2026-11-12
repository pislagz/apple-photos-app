import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetListItem } from "../../api";
import { mockFetch } from "../../testHelpers";
import { useFakeLayout } from "../../testLayout";
import DesktopLibrary from "./DesktopLibrary";

// 912 px at the default 150 px edge (2 px gap) is exactly 6 columns, which these key-move tests assume.
useFakeLayout({ width: 912 });

function item(id: string, date: string): AssetListItem {
  return { id, filename: `${id}.jpg`, date, is_video: false, is_live_photo: false, favorite: false, width: 100, height: 100, duration: null };
}

afterEach(() => vi.unstubAllGlobals());

// Three days: the first has a lead photo plus 20 more (rows of 6, last row 2),
// the next two have a lead plus 14 each.
function days(): AssetListItem[] {
  const out: AssetListItem[] = [];
  for (const [day, count] of [[3, 21], [2, 15], [1, 15]] as const) {
    for (let i = 0; i < count; i++) out.push(item(`d${day}-${i}`, `2024-05-0${day}T${String(23 - i).padStart(2, "0")}:00:00`));
  }
  return out;
}

function mockAll(items: AssetListItem[]) {
  mockFetch((url) => {
    if (url.startsWith("/api/libraries/1/assets")) return { items, next_cursor: null };
    throw new Error(`unexpected request: ${url}`);
  });
}

function selectedId(container: HTMLElement): string | null {
  return container.querySelector('[data-selected="true"]')?.getAttribute("data-asset-id") ?? null;
}

describe("Days keyboard navigation (D12, D13)", () => {
  it("keeps the column through the lead photo and short rows when moving down (D12)", async () => {
    mockAll(days());
    const { container } = render(<DesktopLibrary libraryId={1} fixedView="days" />);
    await screen.findAllByRole("img");
    const grid = screen.getByTestId("desktop-library-grid");
    // Start on column 3 (index 3) of the first grid row of day 3: d3-4.
    fireEvent.click(container.querySelector('[data-asset-id="d3-4"]') as HTMLElement);
    const seen: (string | null)[] = [];
    for (let i = 0; i < 8; i++) {
      fireEvent.keyDown(grid, { key: "ArrowDown" });
      await waitFor(() => expect(selectedId(container)).not.toBe(seen[seen.length - 1] ?? "d3-4"));
      seen.push(selectedId(container));
    }
    // d3-4 is column 3. Rows of day 3: [1..6], [7..12], [13..18], [19,20].
    // Down: d3-10, d3-16, d3-20 (short row, clamped), then day 2's lead photo
    // (full width), then back to column 3 of day 2's first row: d2-4.
    expect(seen.slice(0, 5)).toEqual(["d3-10", "d3-16", "d3-20", "d2-0", "d2-4"]);
    expect(seen[5]).toBe("d2-10");
  });

  it("restores the column going up through a lead photo", async () => {
    mockAll(days());
    const { container } = render(<DesktopLibrary libraryId={1} fixedView="days" />);
    await screen.findAllByRole("img");
    const grid = screen.getByTestId("desktop-library-grid");
    fireEvent.click(container.querySelector('[data-asset-id="d2-5"]') as HTMLElement);
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    await waitFor(() => expect(selectedId(container)).toBe("d2-0"));
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    await waitFor(() => expect(selectedId(container)).toBe("d3-20"));
  });

  it("does not drift one column right on the 5th Down press from the first press (D13)", async () => {
    mockAll(days());
    const { container } = render(<DesktopLibrary libraryId={1} fixedView="days" />);
    await screen.findAllByRole("img");
    const grid = screen.getByTestId("desktop-library-grid");
    fireEvent.click(container.querySelector('[data-asset-id="d3-1"]') as HTMLElement); // column 0
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      fireEvent.keyDown(grid, { key: "ArrowDown" });
      await waitFor(() => expect(selectedId(container)).not.toBe(seen[seen.length - 1] ?? "d3-1"));
      seen.push(selectedId(container) as string);
    }
    expect(seen).toEqual(["d3-7", "d3-13", "d3-19", "d2-0", "d2-1", "d2-7"]);
  });

  // D13: with nothing focused yet, the first Down used the flat +columns move
  // (item 6 = the last cell of the first row, not the first cell), and the
  // paged end-of-list fallback did the same, so from there on every press
  // was one column off (the 5th press landed one column to the right).
  it("starts from the lead photo's column 0 when nothing is focused and never drifts right (D13)", async () => {
    mockAll(days());
    const { container } = render(<DesktopLibrary libraryId={1} fixedView="days" />);
    await screen.findAllByRole("img");
    const grid = screen.getByTestId("desktop-library-grid");
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      fireEvent.keyDown(grid, { key: "ArrowDown" });
      await waitFor(() => expect(selectedId(container)).not.toBe(seen[seen.length - 1] ?? null));
      seen.push(selectedId(container) as string);
    }
    // Nothing focused: first Down selects the first photo (the lead photo).
    expect(seen).toEqual(["d3-0", "d3-1", "d3-7", "d3-13", "d3-19", "d2-0"]);
  });
});
