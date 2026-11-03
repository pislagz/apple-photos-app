import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetDetailResponse, AssetListItem } from "../../api";
import { mockFetch } from "../../testHelpers";
import DesktopLibrary from "./DesktopLibrary";

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
    await screen.findAllByRole("img");
    const grid = screen.getByTestId("desktop-library-grid");

    // Each ArrowDown moves focus a full row (6 columns at the default
    // zoom); 40 presses lands far outside the virtualizer's overscan
    // window, so this only passes if the focused row gets scrolled into
    // view rather than just updated in state.
    for (let i = 0; i < 40; i++) {
      fireEvent.keyDown(grid, { key: "ArrowDown" });
    }

    await waitFor(() => {
      const focused = container.querySelector('[data-asset-id="p240"][data-selected="true"]');
      expect(focused).not.toBeNull();
    });
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

  it("opens the Viewer on a double-click, at the clicked item's position, and closing it restores the grid", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")];
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      const match = url.match(/^\/api\/libraries\/1\/assets\/([^/?]+)$/);
      if (match) return mockDetail(match[1]);
      throw new Error(`unexpected request: ${url}`);
    });

    const { container } = render(<DesktopLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.doubleClick(cells(container)[1]);

    const viewer = await screen.findByTestId("desktop-viewer");
    expect(viewer.querySelector(".desktop-viewer__media")?.getAttribute("src")).toContain("a2");

    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByTestId("desktop-viewer")).toBeNull();
    expect(screen.getByTestId("desktop-library-grid")).toBeInTheDocument();
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
});
