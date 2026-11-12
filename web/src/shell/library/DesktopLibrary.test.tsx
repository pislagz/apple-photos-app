import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetDetailResponse, AssetListItem } from "../../api";
import { jsonResponse, mockFetch } from "../../testHelpers";
import DesktopLibrary from "./DesktopLibrary";
import { useFakeLayout } from "../../testLayout";

// Virtualized grids need a sized viewport; jsdom has none (#88).
useFakeLayout();

function makeItem(id: string, date: string, overrides: Partial<AssetListItem> = {}): AssetListItem {
  return {
    id,
    filename: `${id}.jpg`,
    date,
    is_video: false,
    is_live_photo: false,
    favorite: false,
    width: 100,
    height: 100,
    duration: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockAssets(items: AssetListItem[]) {
  return mockFetch((url) => {
    const match = url.match(/^\/api\/libraries\/1\/assets\?(.*)$/);
    if (match) {
      const params = new URLSearchParams(match[1]);
      const limit = Number(params.get("limit"));
      const cursor = params.get("cursor");
      const startIndex = cursor ? items.findIndex((item) => item.id === cursor) + 1 : 0;
      const page = items.slice(startIndex, startIndex + limit);
      const nextIndex = startIndex + limit;
      return { items: page, next_cursor: nextIndex < items.length ? items[nextIndex - 1].id : null };
    }
    throw new Error(`unexpected request: ${url}`);
  });
}

function cells(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-testid="library-cell"]'));
}

// Explicit timeout for the few waits that outlast the 1 s default under CPU load (#201).
const SLOW_WAIT = { timeout: 8000 };

describe("DesktopLibrary", () => {
  it("renders thumbnails from the thumb endpoint and never requests an original or /hidden", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")];
    const fetchMock = mockAssets(items);

    render(<DesktopLibrary libraryId={1} />);

    const images = await screen.findAllByRole("img");
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      expect(img.getAttribute("src")).toContain("/thumb/");
      expect(img.getAttribute("src")).not.toContain("/original/");
    }
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/hidden");
    }
  });

  it("switches between Years, Months, and All Photos (no Days tab) with date headers", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2023-02-02T10:00:00")];
    mockAssets(items);

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");

    expect(screen.getByRole("tab", { name: "Years" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "Days" })).toBeNull();
    expect(container.querySelectorAll(".desktop-library__row-header").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    await waitFor(() => expect(container.querySelectorAll(".desktop-library__row-header").length).toBe(0));

    fireEvent.click(screen.getByRole("tab", { name: "Months" }));
    await waitFor(() => expect(container.querySelectorAll(".desktop-library__row-header").length).toBeGreaterThan(0));
  });

  it("shows a favorite heart and video duration from asset data", async () => {
    const items = [
      makeItem("fav", "2024-05-10T10:00:00", { favorite: true }),
      makeItem("vid", "2024-05-09T10:00:00", { is_video: true, duration: 125 }),
    ];
    mockAssets(items);

    render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");

    expect(screen.getByLabelText("Favorite")).toBeInTheDocument();
    expect(screen.getByText("2:05")).toBeInTheDocument();
  });

  it("zoom slider changes the requested thumb size between grid and grid2x", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    mockAssets(items);

    render(<DesktopLibrary libraryId={1} />);
    const [img] = await screen.findAllByRole("img");
    expect(img.getAttribute("src")).toContain("size=grid");
    expect(img.getAttribute("src")).not.toContain("size=grid2x");

    fireEvent.change(screen.getByLabelText("Zoom"), { target: { value: "5" } });
    await waitFor(() => expect(img.getAttribute("src")).toContain("size=grid2x"));
  });

  it("supports click, cmd-click, shift-range, cmd-A, and Escape selection", async () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem(`p${i}`, `2024-05-${String(20 - i).padStart(2, "0")}T10:00:00`),
    );
    mockAssets(items);

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    const grid = screen.getByTestId("desktop-library-grid");

    fireEvent.click(cells(container)[0]);
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");
    expect(cells(container)[0]).toHaveAttribute("data-selected", "true");

    fireEvent.click(cells(container)[2], { metaKey: true });
    expect(screen.getByTestId("selection-count")).toHaveTextContent("2 selected");

    fireEvent.click(cells(container)[4], { shiftKey: true });
    expect(screen.getByTestId("selection-count")).toHaveTextContent("3 selected");

    fireEvent.keyDown(grid, { key: "a", metaKey: true });
    await waitFor(() => expect(screen.getByTestId("selection-count")).toHaveTextContent("5 selected"));

    fireEvent.keyDown(grid, { key: "Escape" });
    expect(screen.getByTestId("selection-count")).toHaveTextContent("");
  });

  it("clicking empty grid space deselects; clicking a tile or a modifier-click does not", async () => {
    const items = Array.from({ length: 3 }, (_, i) => makeItem(`p${i}`, `2024-05-${String(20 - i).padStart(2, "0")}T10:00:00`));
    mockAssets(items);
    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    const grid = screen.getByTestId("desktop-library-grid");

    fireEvent.click(cells(container)[0]);
    fireEvent.click(cells(container)[1], { metaKey: true });
    expect(screen.getByTestId("selection-count")).toHaveTextContent("2 selected");
    fireEvent.click(grid, { metaKey: true });
    expect(screen.getByTestId("selection-count")).toHaveTextContent("2 selected");
    fireEvent.click(grid);
    expect(screen.getByTestId("selection-count")).toHaveTextContent("");
    expect(cells(container)[0]).toHaveAttribute("data-selected", "false");
  });

  it("Escape anywhere deselects, but not while the context menu is open", async () => {
    const items = Array.from({ length: 3 }, (_, i) => makeItem(`p${i}`, `2024-05-${String(20 - i).padStart(2, "0")}T10:00:00`));
    mockAssets(items);
    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");

    fireEvent.click(cells(container)[0]);
    fireEvent.contextMenu(cells(container)[0]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("selection-count")).toHaveTextContent("");
  });

  it("the Deselect button clears the selection and disappears", async () => {
    const items = Array.from({ length: 3 }, (_, i) => makeItem(`p${i}`, `2024-05-${String(20 - i).padStart(2, "0")}T10:00:00`));
    mockAssets(items);
    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    expect(screen.queryByRole("button", { name: "Deselect all" })).toBeNull();

    fireEvent.click(cells(container)[0]);
    fireEvent.click(cells(container)[1], { metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(screen.getByTestId("selection-count")).toHaveTextContent("");
    expect(screen.queryByRole("button", { name: "Deselect all" })).toBeNull();
  });

  it("moves focus/selection with arrow keys and zooms with +", async () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem(`p${i}`, `2024-05-${String(20 - i).padStart(2, "0")}T10:00:00`),
    );
    mockAssets(items);

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    const grid = screen.getByTestId("desktop-library-grid");

    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(cells(container)[1]).toHaveAttribute("data-selected", "true");

    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(cells(container)[2]).toHaveAttribute("data-selected", "true");

    const firstImage = screen.getAllByRole("img")[0];
    expect(firstImage.getAttribute("src")).toContain("size=grid");
    expect(firstImage.getAttribute("src")).not.toContain("size=grid2x");

    fireEvent.keyDown(grid, { key: "+" });
    fireEvent.keyDown(grid, { key: "+" });
    await waitFor(() => expect(screen.getAllByRole("img")[0].getAttribute("src")).toContain("size=grid2x"));
  });

  it("never requests /original from browsing or selecting in the grid", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    const fetchMock = mockAssets(items);

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.click(cells(container)[0]);

    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/original");
    }
  });

  it("cmd-A selects the whole library, not just the pages scrolled into view", async () => {
    const items = Array.from({ length: 300 }, (_, i) =>
      makeItem(`p${i}`, `2024-05-10T10:00:00`),
    );
    const fetchMock = mockAssets(items);

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    expect(cells(container).length).toBeLessThan(300);

    const grid = screen.getByTestId("desktop-library-grid");
    fireEvent.keyDown(grid, { key: "a", metaKey: true });

    await waitFor(() => expect(screen.getByTestId("selection-count")).toHaveTextContent("300 selected"));
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/hidden");
    }
  });

  it("scrolls the focused cell into view as arrow keys move focus far past the visible rows", async () => {
    const items = Array.from({ length: 300 }, (_, i) =>
      makeItem(`p${i}`, `2024-05-10T10:00:00`),
    );
    mockAssets(items);

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img", undefined, SLOW_WAIT);
    const grid = screen.getByTestId("desktop-library-grid");

    // Each ArrowDown moves focus a full row (6 columns at the default
    // zoom); 40 presses lands far outside the virtualizer's overscan
    // window, so this only passes if the focused row gets scrolled into
    // view rather than just updated in state. The first press only selects
    // the first photo (D13), so 41 presses land on row 40.
    for (let i = 0; i < 41; i++) {
      fireEvent.keyDown(grid, { key: "ArrowDown" });
    }

    // 300 cells plus 40 re-renders: the one wait that outlasts the 1 s default
    // when the CPU is starved (#201), so it alone gets a longer timeout.
    await waitFor(
      () => {
        const focused = container.querySelector('[data-asset-id="p240"][data-selected="true"]');
        expect(focused).not.toBeNull();
      },
      SLOW_WAIT,
    );
  });

  it("keeps a hidden asset out of the grid, cmd-A selection, and the count", async () => {
    const visible = [makeItem("v1", "2024-05-10T10:00:00"), makeItem("v2", "2024-05-09T10:00:00")];
    const hidden = makeItem("hidden-1", "2024-05-08T10:00:00");
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets")) return { items: visible, next_cursor: null };
      if (url.startsWith("/api/libraries/1/hidden")) return { items: [hidden], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    expect(container.innerHTML).not.toContain("hidden-1");

    const grid = screen.getByTestId("desktop-library-grid");
    fireEvent.keyDown(grid, { key: "a", metaKey: true });
    await waitFor(() => expect(screen.getByTestId("selection-count")).toHaveTextContent("2 selected"));
    expect(container.innerHTML).not.toContain("hidden-1");
  });

  function mockDetail(id: string, overrides: Partial<AssetDetailResponse> = {}): AssetDetailResponse {
    return {
      id,
      filename: `${id}.jpg`,
      original_filename: `${id}.jpg`,
      title: null,
      description: null,
      date_created: "2024-05-10T10:00:00",
      date_added: "2024-05-10T10:00:00",
      date_modified: "2024-05-10T10:00:00",
      favorite: false,
      hidden: false,
      is_video: false,
      is_live_photo: false,
      is_screenshot: false,
      is_selfie: false,
      is_portrait: false,
      is_panorama: false,
      is_hdr: false,
      is_slow_mo: false,
      is_burst: false,
      width: 100,
      height: 100,
      original_filesize: null,
      latitude: null,
      longitude: null,
      place: null,
      place_country_code: null,
      place_address: null,
      camera_make: null,
      camera_model: null,
      has_edited: false,
      has_live_photo_video: false,
      people: [],
      albums: [],
      ...overrides,
    };
  }

  it("opens the Viewer on a double-click in All Photos, at the clicked item's position, and closing it restores the grid", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")];
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      const match = url.match(/^\/api\/libraries\/1\/assets\/([^/?]+)$/);
      if (match) return mockDetail(match[1]);
      throw new Error(`unexpected request: ${url}`);
    });

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    // Only All Photos opens the Viewer on double-click; Years and Months
    // drill in instead (#126).
    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    await screen.findAllByRole("img");
    fireEvent.doubleClick(cells(container)[1]);

    const viewer = await screen.findByTestId("desktop-viewer");
    expect(viewer.querySelector(".desktop-viewer__media")?.getAttribute("src")).toContain("a2");

    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByTestId("desktop-viewer")).toBeNull();
    expect(screen.getByTestId("desktop-library-grid")).toBeInTheDocument();
  });

  it("double-clicking a Year tile drills into Months scrolled to that tile's year, without opening the Viewer", async () => {
    const items = [
      makeItem("recent", "2024-05-10T10:00:00"),
      ...Array.from({ length: 20 }, (_, i) => makeItem(`jan22-${i}`, `2022-01-${String(20 - i).padStart(2, "0")}T10:00:00`)),
    ];
    mockAssets(items);

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    expect(screen.getByRole("tab", { name: "Years" })).toHaveAttribute("aria-selected", "true");
    const grid = screen.getByTestId("desktop-library-grid");

    const oldestCell = cells(container).find((cell) => cell.getAttribute("data-asset-id") === "jan22-19") as HTMLElement;
    fireEvent.doubleClick(oldestCell);

    expect(screen.queryByTestId("desktop-viewer")).toBeNull();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Months" })).toHaveAttribute("aria-selected", "true"));
    // Overscan keeps every row mounted for a list this small, so DOM order
    // alone can't prove a scroll happened -- `scrollTop` is the real signal.
    await waitFor(() => expect(grid.scrollTop).toBeGreaterThan(0));
  });

  it("double-clicking a Month tile drills into All Photos scrolled to that tile's date, without opening the Viewer", async () => {
    const items = [
      makeItem("recent", "2024-05-10T10:00:00"),
      ...Array.from({ length: 20 }, (_, i) => makeItem(`jan22-${i}`, `2022-01-${String(20 - i).padStart(2, "0")}T10:00:00`)),
    ];
    mockAssets(items);

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.click(screen.getByRole("tab", { name: "Months" }));
    await screen.findAllByRole("img");
    const grid = screen.getByTestId("desktop-library-grid");

    const oldestCell = cells(container).find((cell) => cell.getAttribute("data-asset-id") === "jan22-19") as HTMLElement;
    fireEvent.doubleClick(oldestCell);

    expect(screen.queryByTestId("desktop-viewer")).toBeNull();
    await waitFor(() => expect(screen.getByRole("tab", { name: "All Photos" })).toHaveAttribute("aria-selected", "true"));
    // Overscan keeps every row mounted for a list this small, so DOM order
    // alone can't prove a scroll happened -- `scrollTop` is the real signal.
    await waitFor(() => expect(grid.scrollTop).toBeGreaterThan(0));
  });

  it("in the Days view, double-click and Enter hand the day to onOpenDay instead of opening the Viewer (#152)", async () => {
    const items = [makeItem("recent", "2024-05-10T10:00:00"), makeItem("old", "2022-01-08T10:00:00")];
    mockAssets(items);
    const onOpenDay = vi.fn();

    const { container } = render(<DesktopLibrary libraryId={1} fixedView="days" onOpenDay={onOpenDay} />);
    await screen.findAllByRole("img");
    expect(screen.queryByRole("tab")).toBeNull();

    const cell = cells(container).find((c) => c.getAttribute("data-asset-id") === "old") as HTMLElement;
    fireEvent.doubleClick(cell);
    expect(onOpenDay).toHaveBeenLastCalledWith("old");

    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByTestId("desktop-library-grid"), { key: "Enter" });
    expect(onOpenDay).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("desktop-viewer")).toBeNull();
  });

  it("in the Days view every card is labelled with its own single day, never a range (#157)", async () => {
    const items = [
      makeItem("d1a", "2025-09-19T10:00:00"),
      makeItem("d1b", "2025-09-19T09:00:00"),
      makeItem("d2", "2024-01-02T10:00:00"),
      makeItem("d3", "2023-09-05T10:00:00"),
    ];
    mockAssets(items);

    const { container } = render(<DesktopLibrary libraryId={1} fixedView="days" />);
    await screen.findAllByRole("img");

    expect(container.querySelector(".desktop-library__date-range")).toBeNull();
    const captions = Array.from(container.querySelectorAll(".desktop-library__feature-caption")).map(
      (el) => el.textContent ?? "",
    );
    expect(captions).toHaveLength(3);
    expect(new Set(captions).size).toBe(3);
    for (const text of captions) expect(text).not.toMatch(/[–-]\s/);
    expect(captions[0]).toContain("19");
    expect(captions[0]).toContain("2025");
    expect(captions[2]).toContain("2023");
  });

  it("keeps the date-range title in All Photos", async () => {
    mockAssets([makeItem("a", "2025-09-19T10:00:00"), makeItem("b", "2023-09-05T10:00:00")]);
    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    expect(container.querySelector(".desktop-library__date-range")?.textContent).toContain("–");
  });

  it("starts on initialView and scrolls to initialScrollAssetId (#152)", async () => {
    const items = [
      makeItem("recent", "2024-05-10T10:00:00"),
      ...Array.from({ length: 8 }, (_, i) => makeItem(`jan22-${i}`, `2022-01-${String(8 - i).padStart(2, "0")}T10:00:00`)),
    ];
    mockAssets(items);

    render(<DesktopLibrary libraryId={1} initialView="all" initialScrollAssetId="jan22-7" />);
    await screen.findAllByRole("img");

    expect(screen.getByRole("tab", { name: "All Photos" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByTestId("desktop-library-grid").scrollTop).toBeGreaterThan(0));
    expect(screen.queryByTestId("desktop-viewer")).toBeNull();
  });

  it("opens the Viewer on initialAssetId (Copy Link's deep link) and reports it consumed", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")];
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      const match = url.match(/^\/api\/libraries\/1\/assets\/([^/?]+)$/);
      if (match) return mockDetail(match[1]);
      throw new Error(`unexpected request: ${url}`);
    });
    const onInitialAssetOpened = vi.fn();

    render(<DesktopLibrary libraryId={1} initialAssetId="a2" onInitialAssetOpened={onInitialAssetOpened} />);

    const viewer = await screen.findByTestId("desktop-viewer");
    expect(viewer.querySelector(".desktop-viewer__media")?.getAttribute("src")).toContain("a2");
    expect(onInitialAssetOpened).toHaveBeenCalledTimes(1);
  });

  it("silently ignores an initialAssetId that never shows up in this grid (hidden or foreign)", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });
    const onInitialAssetOpened = vi.fn();

    render(<DesktopLibrary libraryId={1} initialAssetId="does-not-exist" onInitialAssetOpened={onInitialAssetOpened} />);
    await screen.findAllByRole("img");

    await waitFor(() => expect(onInitialAssetOpened).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("desktop-viewer")).toBeNull();
  });

  it("opens the Viewer on the focused cell with Space or Enter", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")];
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      const match = url.match(/^\/api\/libraries\/1\/assets\/([^/?]+)$/);
      if (match) return mockDetail(match[1]);
      throw new Error(`unexpected request: ${url}`);
    });

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    // Only All Photos opens the Viewer on Enter/Space; Years and Months
    // drill in instead (#126).
    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    await screen.findAllByRole("img");
    const grid = screen.getByTestId("desktop-library-grid");

    fireEvent.click(cells(container)[0]);
    fireEvent.keyDown(grid, { key: "Enter" });
    let viewer = await screen.findByTestId("desktop-viewer");
    expect(viewer.querySelector(".desktop-viewer__media")?.getAttribute("src")).toContain("a1");
    fireEvent.keyDown(viewer, { key: "Escape" });
    expect(screen.queryByTestId("desktop-viewer")).toBeNull();

    fireEvent.keyDown(grid, { key: " " });
    viewer = await screen.findByTestId("desktop-viewer");
    expect(viewer.querySelector(".desktop-viewer__media")?.getAttribute("src")).toContain("a1");
  });

  it("right-click opens a context menu to download the asset, independent of the multi-selection", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")];
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      const match = url.match(/^\/api\/libraries\/1\/assets\/([^/?]+)$/);
      if (match) return mockDetail(match[1]);
      throw new Error(`unexpected request: ${url}`);
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    // Right-clicking a cell that isn't part of the current selection still
    // shows its own Download/Copy Link menu.
    fireEvent.click(cells(container)[0]);
    fireEvent.contextMenu(cells(container)[1]);

    const menu = await screen.findByTestId("context-menu");
    expect(clickSpy).not.toHaveBeenCalled();

    fireEvent.click(within(menu).getByText("Download"));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("context-menu")).toBeNull();
    expect(menu).not.toBeInTheDocument();
    clickSpy.mockRestore();
  });

  it("right-click's Download Original always requests version=original, bypassing the edited default", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      const match = url.match(/^\/api\/libraries\/1\/assets\/([^/?]+)$/);
      if (match) return mockDetail(match[1], { has_edited: true });
      throw new Error(`unexpected request: ${url}`);
    });
    let href = "";
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      href = this.href;
    });

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.contextMenu(cells(container)[0]);
    const menu = await screen.findByTestId("context-menu");

    fireEvent.click(await within(menu).findByText("Download Original"));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(href).toContain("/original/a1");
    expect(href).not.toContain("version=edited");
    clickSpy.mockRestore();
  });

  it("right-click's menu has no Download Original for a photo that was never edited", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      const match = url.match(/^\/api\/libraries\/1\/assets\/([^/?]+)$/);
      if (match) return mockDetail(match[1], { has_edited: false });
      throw new Error(`unexpected request: ${url}`);
    });

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.contextMenu(cells(container)[0]);
    const menu = await screen.findByTestId("context-menu");

    await within(menu).findByText("Download");
    expect(within(menu).queryByText("Download Original")).toBeNull();
  });

  it("right-click's Copy Link copies an in-app URL, and Escape dismisses the menu", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.contextMenu(cells(container)[0]);
    const menu = await screen.findByTestId("context-menu");

    fireEvent.click(within(menu).getByText("Copy Link"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/library/1/photo/a1")));
    expect(screen.queryByTestId("context-menu")).toBeNull();

    fireEvent.contextMenu(cells(container)[0]);
    await screen.findByTestId("context-menu");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("context-menu")).toBeNull();
  });

  describe("Filter By menu", () => {
    function assetCalls(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams[] {
      return fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes("/assets?"))
        .map((url) => new URLSearchParams(url.split("?")[1]));
    }

    it("offers the four options and reloads the grid with the matching params", async () => {
      const fetchMock = mockAssets([makeItem("a1", "2024-05-10T10:00:00")]);
      render(<DesktopLibrary libraryId={1} />);
      await screen.findAllByRole("img");

      const button = screen.getByRole("button", { name: "Filter By" });
      expect(button).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(button);
      const menu = screen.getByRole("menu", { name: "Filter By" });
      expect(within(menu).getAllByRole("menuitemradio").map((el) => el.textContent?.replace("✓", ""))).toEqual([
        "All Items",
        "Favorites",
        "Photos",
        "Videos",
      ]);

      fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Videos/ }));
      expect(screen.queryByRole("menu")).toBeNull();
      await waitFor(() => expect(assetCalls(fetchMock).at(-1)?.get("type")).toBe("video"));
      expect(screen.getByRole("button", { name: "Filter By" })).toHaveAttribute("aria-pressed", "true");

      fireEvent.click(screen.getByRole("button", { name: "Filter By" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: /Favorites/ }));
      await waitFor(() => expect(assetCalls(fetchMock).at(-1)?.get("favorite")).toBe("true"));
      expect(assetCalls(fetchMock).at(-1)?.get("type")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Filter By" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: /All Items/ }));
      await waitFor(() => expect(assetCalls(fetchMock).length).toBe(4));
      expect(assetCalls(fetchMock).at(-1)?.get("favorite")).toBeNull();
      expect(screen.getByRole("button", { name: "Filter By" })).toHaveAttribute("aria-pressed", "false");
    });

    it("closes on Escape and on outside click", async () => {
      mockAssets([makeItem("a1", "2024-05-10T10:00:00")]);
      render(<DesktopLibrary libraryId={1} />);
      await screen.findAllByRole("img");

      fireEvent.click(screen.getByRole("button", { name: "Filter By" }));
      expect(screen.getByRole("menu")).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Filter By" }));
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("the Viewer opened from a filtered grid steps through the filtered items only", async () => {
      const items = [
        makeItem("f1", "2024-05-10T10:00:00", { favorite: true }),
        makeItem("n1", "2024-05-09T10:00:00"),
        makeItem("f2", "2024-05-08T10:00:00", { favorite: true }),
        makeItem("n2", "2024-05-07T10:00:00"),
        makeItem("f3", "2024-05-06T10:00:00", { favorite: true }),
      ];
      mockFetch((url) => {
        if (url.startsWith("/api/libraries/1/assets?")) {
          const params = new URLSearchParams(url.split("?")[1]);
          const list = params.get("favorite") === "true" ? items.filter((item) => item.favorite) : items;
          return { items: list, next_cursor: null };
        }
        const match = url.match(/^\/api\/libraries\/1\/assets\/([^/?]+)$/);
        if (match) return mockDetail(match[1]);
        throw new Error(`unexpected request: ${url}`);
      });

      const { container } = render(<DesktopLibrary libraryId={1} />);
      await screen.findAllByRole("img");
      fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
      await waitFor(() => expect(cells(container)).toHaveLength(5));

      fireEvent.click(screen.getByRole("button", { name: "Filter By" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: /Favorites/ }));
      await waitFor(() => expect(cells(container)).toHaveLength(3));

      fireEvent.doubleClick(cells(container)[0]);
      const viewer = await screen.findByTestId("desktop-viewer");
      const src = () => viewer.querySelector(".desktop-viewer__media")?.getAttribute("src") ?? "";
      expect(src()).toContain("f1");

      fireEvent.keyDown(viewer, { key: "ArrowRight" });
      await waitFor(() => expect(src()).toContain("f2"));
      fireEvent.keyDown(viewer, { key: "ArrowRight" });
      await waitFor(() => expect(src()).toContain("f3"));
      fireEvent.keyDown(viewer, { key: "ArrowLeft" });
      await waitFor(() => expect(src()).toContain("f2"));
      expect(src()).not.toContain("n1");
    });
  });
});

describe("DesktopLibrary assets failure (#147)", () => {
  it.each(["Years", "Months"])("shows an error and Retry in %s instead of 'No photos yet.', then recovers", async (name) => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    let fail = true;
    mockFetch((url) => {
      if (url.match(/^\/api\/libraries\/1\/assets\?/)) {
        return fail ? new Response("boom", { status: 500 }) : { items, next_cursor: null };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    render(<DesktopLibrary libraryId={1} />);
    if (name === "Months") fireEvent.click(screen.getByRole("tab", { name: "Months" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your library.");
    expect(screen.queryByText("No photos yet.")).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("No photos yet.")).toBeNull();
    expect(await screen.findAllByRole("img")).not.toHaveLength(0);
  });
});

describe("DesktopLibrary date-range title (#118)", () => {
  it("covers the visible rows only and follows scroll", async () => {
    // One photo per month, newest first: Dec 2025 back to Jan 2016.
    const items = Array.from({ length: 120 }, (_, i) => {
      const year = 2025 - Math.floor((i + 0) / 12);
      const month = 12 - (i % 12);
      return makeItem(`m${i}`, `${year}-${String(month).padStart(2, "0")}-15T10:00:00`);
    });
    mockAssets(items);
    const { container } = render(<DesktopLibrary libraryId={1} initialView="all" />);
    await screen.findAllByRole("img");

    const label = () => container.querySelector(".desktop-library__date-range")?.textContent ?? "";
    await waitFor(() => expect(label()).toContain("2025"));
    expect(label()).not.toContain("2016");

    const grid = screen.getByTestId("desktop-library-grid");
    grid.scrollTop = 135 * 18;
    fireEvent.scroll(grid);
    await waitFor(() => expect(label()).not.toContain("2025"));
    expect(label()).toMatch(/20(1\d|2[0-3])/);
  });
});

describe("DesktopLibrary drag-select (#97)", () => {
  // Cells are laid out by hand: 100px squares, 4 per row, starting at (0, 0).
  function stubCellRects() {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function rect(this: Element) {
      const id = this.getAttribute("data-asset-id");
      if (id === null) return original.call(this);
      const n = Number(id.slice(1));
      const left = (n % 4) * 100;
      const top = Math.floor(n / 4) * 100;
      return { left, top, width: 100, height: 100, right: left + 100, bottom: top + 100, x: left, y: top, toJSON() {} } as DOMRect;
    };
    return () => {
      Element.prototype.getBoundingClientRect = original;
    };
  }

  it("draws a marquee and selects live as the pointer moves, starting on a cell", async () => {
    const items = Array.from({ length: 8 }, (_, i) => makeItem(`c${i}`, `2024-05-${String(20 - i).padStart(2, "0")}T10:00:00`));
    mockAssets(items);
    render(<DesktopLibrary libraryId={1} initialView="all" />);
    await screen.findAllByRole("img");
    const restore = stubCellRects();
    try {
      const grid = screen.getByTestId("desktop-library-grid");
      const first = grid.querySelector('[data-asset-id="c0"]') as HTMLElement;
      fireEvent.mouseDown(first, { button: 0, clientX: 10, clientY: 10 });
      // Below the threshold: no marquee, no selection yet.
      fireEvent.mouseMove(window, { clientX: 12, clientY: 11 });
      expect(screen.queryByTestId("marquee")).toBeNull();

      fireEvent.mouseMove(window, { clientX: 150, clientY: 50 });
      expect(screen.getByTestId("marquee")).toBeInTheDocument();
      expect(screen.getByTestId("selection-count")).toHaveTextContent("2 selected");

      fireEvent.mouseMove(window, { clientX: 150, clientY: 150 });
      expect(screen.getByTestId("selection-count")).toHaveTextContent("4 selected");

      fireEvent.mouseUp(window);
      expect(screen.queryByTestId("marquee")).toBeNull();
      // The click that follows a drag must not collapse the selection.
      fireEvent.click(first);
      expect(screen.getByTestId("selection-count")).toHaveTextContent("4 selected");
    } finally {
      restore();
    }
  });

  it("a plain click on a cell still selects only that cell", async () => {
    mockAssets([makeItem("c0", "2024-05-10T10:00:00"), makeItem("c1", "2024-05-09T10:00:00")]);
    render(<DesktopLibrary libraryId={1} initialView="all" />);
    await screen.findAllByRole("img");
    const grid = screen.getByTestId("desktop-library-grid");
    const second = grid.querySelector('[data-asset-id="c1"]') as HTMLElement;
    fireEvent.mouseDown(second, { button: 0, clientX: 5, clientY: 5 });
    fireEvent.mouseUp(window);
    fireEvent.click(second);
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");
  });
});

describe("DesktopLibrary Info panel (#98)", () => {
  it("opens an inspector for the focused cell with the asset's details", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      if (url === "/api/libraries/1/assets/a1")
        return {
          id: "a1", filename: "a1.jpg", original_filename: "a1.jpg", title: null, description: null,
          date_created: "2024-05-10T10:00:00", date_added: "2024-05-10T10:00:00", date_modified: "2024-05-10T10:00:00",
          favorite: false, hidden: false, is_video: false, is_live_photo: false, is_screenshot: false, is_selfie: false,
          is_portrait: false, is_panorama: false, is_hdr: false, is_slow_mo: false, is_burst: false, width: 100, height: 100,
          original_filesize: 2_400_000, latitude: null, longitude: null, place: null, place_country_code: null,
          place_address: null, camera_make: "Apple", camera_model: "iPhone 15 Pro", has_edited: false,
          has_live_photo_video: false, people: [], albums: [],
        } satisfies AssetDetailResponse;
      throw new Error(`unexpected request: ${url}`);
    });
    render(<DesktopLibrary libraryId={1} initialView="all" />);
    const cell = (await screen.findAllByTestId("library-cell"))[0];

    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    expect(screen.getByTestId("library-info-panel")).toHaveTextContent("No Selection");

    fireEvent.click(cell);
    await waitFor(() => expect(screen.getByTestId("library-info-panel")).toHaveTextContent("iPhone 15 Pro"));

    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    expect(screen.queryByTestId("library-info-panel")).toBeNull();
  });
});

describe("DesktopLibrary Info panel errors (#98)", () => {
  it("says the info could not be loaded instead of Loading forever", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      if (url === "/api/libraries/1/assets/a1") return jsonResponse({ detail: "boom" }, 500);
      throw new Error("unexpected request: " + url);
    });
    render(<DesktopLibrary libraryId={1} initialView="all" />);
    const cell = (await screen.findAllByTestId("library-cell"))[0];
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    fireEvent.click(cell);
    await waitFor(() => expect(screen.getByTestId("library-info-panel")).toHaveTextContent("Couldn't load info."));
  });
});

describe("DesktopLibrary person grid text (#193)", () => {
  it("says 'person', not 'album', when a person has no photos", async () => {
    mockFetch((url) => {
      if (url.match(/^\/api\/libraries\/1\/assets\?/)) return { items: [], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<DesktopLibrary libraryId={1} album="person:p1" fixedView="all" />);
    expect(await screen.findByText("No photos of this person.")).toBeInTheDocument();
    expect(screen.queryByText("No photos in this album.")).toBeNull();
  });

  it("says 'person', not 'album', when a person's photos fail to load", async () => {
    mockFetch((url) => {
      if (url.match(/^\/api\/libraries\/1\/assets\?/)) return new Response("boom", { status: 500 });
      throw new Error(`unexpected request: ${url}`);
    });
    render(<DesktopLibrary libraryId={1} album="person:p1" fixedView="all" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this person's photos.");
  });
});

describe("DesktopLibrary Info panel multi-selection (D21)", () => {
  const items = [
    makeItem("a1", "2024-03-09T10:00:00"),
    makeItem("a2", "2024-03-05T10:00:00", { is_video: true }),
    makeItem("a3", "2024-03-03T10:00:00"),
  ];

  function mockWithSummary(summary: object | null) {
    return mockFetch((url, init) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      if (url === "/api/libraries/1/selection-summary") {
        if (!summary) return jsonResponse({ detail: "boom" }, 500);
        return summary;
      }
      if (url.startsWith("/api/libraries/1/assets/")) return jsonResponse({ detail: "no" }, 500);
      throw new Error(`unexpected request: ${url} ${init?.method}`);
    });
  }

  it("shows count, photo/video split, date range, size and a shared place for 2+ selected", async () => {
    const fetchMock = mockWithSummary({
      count: 3, photos: 2, videos: 1, date_first: "2024-03-03T10:00:00", date_last: "2024-03-09T10:00:00",
      total_bytes: 3 * 1024 * 1024, place: "Zurich",
    });
    render(<DesktopLibrary libraryId={1} initialView="all" />);
    await screen.findAllByTestId("library-cell");
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    const grid = screen.getByTestId("desktop-library-grid");
    fireEvent.keyDown(grid, { key: "a", metaKey: true });

    const panel = screen.getByTestId("library-info-panel");
    await waitFor(() => expect(panel).toHaveTextContent("3 items (2 photos, 1 video)"));
    expect(panel).toHaveTextContent(/3–9 Mar 2024/);
    expect(panel).toHaveTextContent("3.0 MB");
    expect(panel).toHaveTextContent("Zurich");
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/libraries/1/selection-summary");
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ asset_ids: expect.arrayContaining(["a1", "a2", "a3"]) });
    // No per-photo detail request was made for the selection.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/libraries/1/assets/"))).toBe(false);
  });

  it("leaves out the place when the summary has none, and says so when loading fails", async () => {
    mockWithSummary({
      count: 3, photos: 3, videos: 0, date_first: "2024-03-03T10:00:00", date_last: "2024-03-03T12:00:00",
      total_bytes: 2048, place: null,
    });
    render(<DesktopLibrary libraryId={1} initialView="all" />);
    await screen.findAllByTestId("library-cell");
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    fireEvent.keyDown(screen.getByTestId("desktop-library-grid"), { key: "a", metaKey: true });
    const panel = screen.getByTestId("library-info-panel");
    await waitFor(() => expect(panel).toHaveTextContent("3 photos"));
    expect(panel).toHaveTextContent("3 Mar 2024");
    expect(panel).not.toHaveTextContent("Location");
  });

  it("says it could not load the summary", async () => {
    mockWithSummary(null);
    render(<DesktopLibrary libraryId={1} initialView="all" />);
    await screen.findAllByTestId("library-cell");
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    fireEvent.keyDown(screen.getByTestId("desktop-library-grid"), { key: "a", metaKey: true });
    await waitFor(() => expect(screen.getByTestId("library-info-panel")).toHaveTextContent("Couldn't load info."));
  });

  it("goes back to the single photo's details when the selection shrinks to one", async () => {
    mockWithSummary({
      count: 3, photos: 3, videos: 0, date_first: null, date_last: null, total_bytes: 0, place: null,
    });
    render(<DesktopLibrary libraryId={1} initialView="all" />);
    const cells = await screen.findAllByTestId("library-cell");
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    fireEvent.keyDown(screen.getByTestId("desktop-library-grid"), { key: "a", metaKey: true });
    await waitFor(() => expect(screen.getByTestId("library-info-panel")).toHaveTextContent("3 photos"));
    fireEvent.click(cells[0]);
    await waitFor(() => expect(screen.getByTestId("library-info-panel")).toHaveTextContent("Couldn't load info."));
    expect(screen.getByTestId("library-info-panel")).not.toHaveTextContent("3 photos");
  });
});
