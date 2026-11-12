import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetListItem } from "../../api";
import { getThumb, mockFetch, queryThumb } from "../../testHelpers";
import MobileLibrary from "./MobileLibrary";
import { useFakeLayout } from "../../testLayout";

// Virtualized grids need a sized viewport; jsdom has none (#88).
useFakeLayout();

function makeItem(id: string, date: string): AssetListItem {
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
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// #91: mirrors the server's `/summary` grouping (year/month/day prefixes of
// `date_created`, `hidden`-filtered already by whatever `items` the caller
// passes in) closely enough for these component tests -- `favorite`/`score`
// ordering of `key_asset_ids` is exercised server-side, not here.
function computeSummary(items: AssetListItem[]) {
  const bucket = (length: number) => {
    const byKey = new Map<string, { count: number; ids: string[] }>();
    for (const item of items) {
      if (!item.date) continue;
      const key = item.date.slice(0, length);
      const entry = byKey.get(key) ?? { count: 0, ids: [] };
      entry.count += 1;
      if (entry.ids.length < 5) entry.ids.push(item.id);
      byKey.set(key, entry);
    }
    return [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  };
  return {
    years: bucket(4).map(([key, { count, ids }]) => ({ key, count, key_asset_ids: ids })),
    months: bucket(7).map(([key, { count, ids }]) => ({ key, count, key_asset_ids: ids })),
    days: bucket(10).map(([key, { count }]) => ({ key, count })),
  };
}

// Serves `/summary` and `/assets` (including the `to` anchor #91 added for
// the Month -> Days drill-down) from one in-memory `items` list, and defers
// anything else to `extra` -- so each test only has to describe the routes
// beyond those two shared ones.
function mockLibraryFetch(items: AssetListItem[], extra?: (url: string) => unknown) {
  return mockFetch((url) => {
    if (url === "/api/libraries/1/summary") return computeSummary(items);
    const match = url.match(/^\/api\/libraries\/1\/assets\?(.*)$/);
    if (match) {
      const params = new URLSearchParams(match[1]);
      const limit = Number(params.get("limit"));
      const cursor = params.get("cursor");
      const to = params.get("to");
      const pool = to ? items.filter((item) => (item.date ?? "").slice(0, 10) <= to) : items;
      const startIndex = cursor ? pool.findIndex((item) => item.id === cursor) + 1 : 0;
      const page = pool.slice(startIndex, startIndex + limit);
      const nextIndex = startIndex + limit;
      return { items: page, next_cursor: nextIndex < pool.length ? pool[nextIndex - 1].id : null };
    }
    if (extra) {
      const result = extra(url);
      if (result !== undefined) return result;
    }
    throw new Error(`unexpected request: ${url}`);
  });
}

function mockAssets(items: AssetListItem[]) {
  return mockLibraryFetch(items);
}

describe("MobileLibrary", () => {
  it("renders thumbnails from the thumb endpoint and never requests an original or /hidden", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")];
    const fetchMock = mockAssets(items);

    render(<MobileLibrary libraryId={1} />);

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

  it("switches between Years, Months, Days, and All Photos, with All Photos as a uniform grid", async () => {
    const items = [
      makeItem("a1", "2024-05-10T10:00:00"),
      makeItem("a2", "2023-02-02T10:00:00"),
    ];
    mockAssets(items);

    const { container } = render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");

    expect(screen.getByRole("tab", { name: "Years" })).toHaveAttribute("aria-selected", "true");
    expect(container.querySelectorAll(".mobile-library__tile").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    expect(screen.getByRole("tab", { name: "All Photos" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(container.querySelectorAll(".mobile-library__tile").length).toBe(0));
    expect(container.querySelectorAll(".mobile-library__row-grid").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "Months" }));
    await waitFor(() => expect(container.querySelectorAll(".mobile-library__tile").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("tab", { name: "Days" }));
    await waitFor(() => expect(container.querySelectorAll(".mobile-library__row-feature").length).toBeGreaterThan(0));
  });

  it("updates the pinned date header to the topmost visible day while scrolling All Photos", async () => {
    const items = [
      makeItem("may-1", "2024-05-10T10:00:00"),
      makeItem("may-2", "2024-05-09T10:00:00"),
      ...Array.from({ length: 20 }, (_, i) => makeItem(`apr-${i}`, `2024-04-${String(20 - i).padStart(2, "0")}T10:00:00`)),
    ];
    mockAssets(items);

    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    // Years/Months no longer have a pinned header (each tile already shows
    // its own label); only All Photos' uniform grid still needs one.
    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    await waitFor(() => expect(screen.getByTestId("pinned-header")).toHaveTextContent("May 10, 2024"));

    const scrollEl = screen.getByTestId("library-scroll");
    // One grid row (cellSize 200px with the mocked 800px-wide container / 4
    // columns) comfortably clears the first row (may-1, may-2, apr-0, apr-1).
    scrollEl.scrollTop = 220;
    fireEvent.scroll(scrollEl);

    await waitFor(() => expect(screen.getByTestId("pinned-header")).toHaveTextContent("April 18, 2024"));
  });

  it("puts the pinned title and Select in one flex top bar (#159)", async () => {
    mockAssets([makeItem("a1", "2024-05-10T10:00:00")]);
    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    const title = await screen.findByTestId("pinned-header");
    const select = screen.getByRole("button", { name: "Select" });
    const bar = screen.getByTestId("top-bar");
    expect(title.parentElement).toBe(bar);
    expect(select.parentElement).toBe(bar);
    // Select follows the title in flow, so the two cannot overlap.
    expect(title.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(select);
    expect(screen.getByRole("button", { name: "Cancel" }).parentElement).toBe(bar);
  });

  it("keeps the scrim behind Select on the Days view too (#176)", async () => {
    mockAssets([makeItem("a1", "2024-05-10T10:00:00")]);
    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.click(screen.getByRole("tab", { name: "Days" }));
    const bar = await screen.findByTestId("top-bar");
    expect(bar).toHaveAttribute("data-scrim", "true");
    expect(screen.getByRole("button", { name: "Select" }).parentElement).toBe(bar);
  });

  it("changes the column count on a pinch gesture", async () => {
    const items = Array.from({ length: 12 }, (_, i) => makeItem(`p${i}`, `2024-05-${String(20 - i).padStart(2, "0")}T10:00:00`));
    mockAssets(items);

    const { container } = render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    // Pinch-to-zoom only applies to the uniform grid, not Years/Months tiles.
    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    await screen.findAllByRole("img");

    const scrollEl = screen.getByTestId("library-scroll");
    const initialWidth = (container.querySelector(".mobile-library__cell") as HTMLImageElement).style.width;
    expect(initialWidth).toBe("200px"); // 800px container / 4 default columns

    // Pinch in (fingers moving together): zoom out to more, smaller columns.
    fireEvent.touchStart(scrollEl, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 200, clientY: 0 }] });
    fireEvent.touchMove(scrollEl, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] });

    await waitFor(() => {
      const width = (container.querySelector(".mobile-library__cell") as HTMLImageElement).style.width;
      expect(width).not.toBe(initialWidth);
    });
  });

  it("allows one-finger swipe scrolling instead of blocking all touch panning", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    mockAssets(items);

    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");

    const scrollEl = screen.getByTestId("library-scroll");
    // `touch-action: none` would also block one-finger swipe scrolling on a
    // real phone; `pan-y` keeps vertical swipe-scroll working while still
    // letting the pinch handlers see two-finger gestures.
    expect(scrollEl.style.touchAction).toBe("pan-y");
  });

  it("opens the Viewer on tap in All Photos, at the tapped item's position, and closing it restores the grid", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")];
    mockLibraryFetch(items, (url) => {
      const match = url.match(/^\/api\/libraries\/1\/assets\/([^/?]+)$/);
      if (match) {
        return {
          id: match[1],
          filename: `${match[1]}.jpg`,
          original_filename: `${match[1]}.jpg`,
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
        };
      }
      return undefined;
    });

    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    // Only the terminal zoom level (All Photos, or Days -- covered below)
    // opens the Viewer on tap; Years and Months drill in instead (#126).
    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    const images = await screen.findAllByRole("img");
    const a2Image = images.find((img) => img.getAttribute("src")?.includes("/thumb/a2?"));
    fireEvent.click(a2Image as HTMLImageElement);

    const viewer = await screen.findByTestId("mobile-viewer");
    expect(viewer.querySelector("img")?.getAttribute("src")).toContain("a2");

    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByTestId("mobile-viewer")).toBeNull();
  });

  it("the library behind the Viewer is inert, and closing restores focus to the thumbnail (D59)", async () => {
    mockAssets([makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")]);
    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    await waitFor(() => expect(document.querySelector('[data-asset-id="a2"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-asset-id="a2"]') as HTMLElement);
    const viewer = await screen.findByTestId("mobile-viewer");
    expect(viewer.closest("[inert]")).toBeNull();
    expect(screen.getByRole("tablist", { name: "Library zoom" }).closest("[inert]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("mobile-viewer")).toBeNull());
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('[data-asset-id="a2"]'));
  });

  it("tapping a Year tile drills into Months scrolled to that tile's year, without opening the Viewer", async () => {
    const items = [
      makeItem("recent", "2024-05-10T10:00:00"),
      ...Array.from({ length: 20 }, (_, i) => makeItem(`jan22-${i}`, `2022-01-${String(20 - i).padStart(2, "0")}T10:00:00`)),
    ];
    mockAssets(items);

    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    expect(screen.getByRole("tab", { name: "Years" })).toHaveAttribute("aria-selected", "true");

    // Tapping anywhere in the tile (its label text bubbles up to the
    // SummaryTile button) drills in -- not an individual photo, since Years
    // tiles no longer render a per-asset grid.
    fireEvent.click(screen.getByText("2022"));

    expect(screen.queryByTestId("mobile-viewer")).toBeNull();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Months" })).toHaveAttribute("aria-selected", "true"));
    await waitFor(() => expect(screen.getByText("January 2022")).toBeInTheDocument());
    // 2022's own tile is the older (second, since newest sorts first) of
    // the two Month tiles -- scrolled past the top only if the drill-down
    // actually scrolled Months to it instead of leaving it at the default
    // top-of-list position.
    const scrollEl = screen.getByTestId("library-scroll");
    await waitFor(() => expect(scrollEl.scrollTop).toBeGreaterThan(0));
  });

  it("tapping a Month tile anchors Days to that tile's month, without opening the Viewer", async () => {
    const items = [
      makeItem("recent", "2024-05-10T10:00:00"),
      ...Array.from({ length: 20 }, (_, i) => makeItem(`jan22-${i}`, `2022-01-${String(20 - i).padStart(2, "0")}T10:00:00`)),
    ];
    mockAssets(items);

    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.click(screen.getByRole("tab", { name: "Months" }));
    await screen.findByText("January 2022");

    fireEvent.click(screen.getByText("January 2022"));

    expect(screen.queryByTestId("mobile-viewer")).toBeNull();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Days" })).toHaveAttribute("aria-selected", "true"));
    // The anchor (`to=2022-01-31`) must exclude "recent" (2024-05-10) and
    // land Days at the top of January 2022 -- its newest day
    // (2022-01-20, "jan22-0"), not scrolled to a specific older day.
    await waitFor(() => expect(screen.getByText("January 20, 2022")).toBeInTheDocument());
    expect(getThumb("jan22-0")).toBeInTheDocument();
    expect(queryThumb("recent")).toBeNull();
  });

  it("re-selecting All Photos after jumping to an older month clears the anchor and loads the newest photos (#146)", async () => {
    const items = [
      makeItem("recent", "2024-05-10T10:00:00"),
      ...Array.from({ length: 20 }, (_, i) => makeItem(`jan22-${i}`, `2022-01-${String(20 - i).padStart(2, "0")}T10:00:00`)),
    ];
    const fetchMock = mockAssets(items);

    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.click(screen.getByRole("tab", { name: "Months" }));
    fireEvent.click(await screen.findByText("January 2022"));
    await waitFor(() => expect(getThumb("jan22-0")).toBeInTheDocument());
    expect(queryThumb("recent")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));

    await waitFor(() => expect(getThumb("recent")).toBeInTheDocument());
    const lastAssetsUrl = String(
      fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/assets?")).at(-1),
    );
    expect(new URLSearchParams(lastAssetsUrl.split("?")[1]).get("to")).toBeNull();
    expect(screen.getByTestId("library-scroll").scrollTop).toBe(0);
  });

  it("bumping resetSignal (Library tab re-tap) drops the anchor and returns to the newest photos (#146)", async () => {
    const items = [
      makeItem("recent", "2024-05-10T10:00:00"),
      ...Array.from({ length: 20 }, (_, i) => makeItem(`jan22-${i}`, `2022-01-${String(20 - i).padStart(2, "0")}T10:00:00`)),
    ];
    mockAssets(items);

    const { rerender } = render(<MobileLibrary libraryId={1} resetSignal={0} />);
    await screen.findAllByRole("img");
    fireEvent.click(screen.getByRole("tab", { name: "Months" }));
    fireEvent.click(await screen.findByText("January 2022"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Days" })).toHaveAttribute("aria-selected", "true"));
    await waitFor(() => expect(queryThumb("recent")).toBeNull());

    rerender(<MobileLibrary libraryId={1} resetSignal={1} />);

    await waitFor(() => expect(getThumb("recent")).toBeInTheDocument());
  });

  it("opens the Viewer on initialAssetId (Copy Link's deep link) and reports it consumed", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")];
    mockFetch((url) => {
      if (url === "/api/libraries/1/summary") return computeSummary(items);
      if (url.match(/^\/api\/libraries\/1\/assets\?/)) return { items, next_cursor: null };
      const match = url.match(/^\/api\/libraries\/1\/assets\/([^/?]+)$/);
      if (match) {
        return {
          id: match[1], filename: `${match[1]}.jpg`, original_filename: `${match[1]}.jpg`, title: null, description: null,
          date_created: "2024-05-10T10:00:00", date_added: "2024-05-10T10:00:00", date_modified: "2024-05-10T10:00:00",
          favorite: false, hidden: false, is_video: false, is_live_photo: false, is_screenshot: false, is_selfie: false,
          is_portrait: false, is_panorama: false, is_hdr: false, is_slow_mo: false, is_burst: false, width: 100, height: 100,
          original_filesize: null, latitude: null, longitude: null, place: null, place_country_code: null, place_address: null,
          camera_make: null, camera_model: null, has_edited: false, has_live_photo_video: false, people: [], albums: [],
        };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const onInitialAssetOpened = vi.fn();

    render(<MobileLibrary libraryId={1} initialAssetId="a2" onInitialAssetOpened={onInitialAssetOpened} />);

    const viewer = await screen.findByTestId("mobile-viewer");
    expect(viewer.querySelector("img")?.getAttribute("src")).toContain("a2");
    expect(onInitialAssetOpened).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("library-scroll")).toBeInTheDocument();
  });

  it("keeps a hidden asset out of Years, Months, Days, and All Photos", async () => {
    // The server already excludes hidden assets from `/assets`; this fixture
    // mirrors that by keeping "hidden-1" out of the `/assets` page while
    // still serving it from `/hidden`, so the test fails if the component
    // ever falls back to that endpoint or otherwise surfaces the id.
    const visible = [makeItem("v1", "2024-05-10T10:00:00"), makeItem("v2", "2024-05-09T10:00:00")];
    const hidden = makeItem("hidden-1", "2024-05-08T10:00:00");
    // `/summary`'s buckets are built from `visible` alone, mirroring the
    // server's own `hidden = 0` filter on `key_asset_ids` and `count`.
    mockLibraryFetch(visible, (url) => {
      if (url.startsWith("/api/libraries/1/hidden")) return { items: [hidden], next_cursor: null };
      return undefined;
    });

    const { container } = render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");

    for (const view of ["Years", "Months", "Days", "All Photos"]) {
      fireEvent.click(screen.getByRole("tab", { name: view }));
      await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThan(0));
      expect(container.innerHTML).not.toContain("hidden-1");
    }
  });

  it("Select mode lets you multi-select cells, and Share invokes the Web Share API with files", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")];
    mockLibraryFetch(items, (url) => {
      if (url.startsWith("/api/libraries/1/original/")) {
        return new Response("fake-bytes", { status: 200, headers: { "Content-Type": "image/jpeg" } });
      }
      return undefined;
    });
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, share, canShare });

    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    // Select mode has nothing to select on Years/Months tiles -- only All
    // Photos and Days show the Select button.
    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    const images = await screen.findAllByRole("img");
    fireEvent.click(screen.getByText("Select"));

    const a1Image = images.find((img) => img.getAttribute("src")?.includes("/thumb/a1?")) as HTMLImageElement;
    const a2Image = images.find((img) => img.getAttribute("src")?.includes("/thumb/a2?")) as HTMLImageElement;
    // Tapping cells in select mode toggles their selection instead of
    // opening the Viewer.
    fireEvent.click(a1Image);
    fireEvent.click(a2Image);
    expect(screen.queryByTestId("mobile-viewer")).toBeNull();
    expect(screen.getByText("2 Selected")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Share"));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(canShare).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].files).toHaveLength(2);
  });

  it("the Deselect button clears the selection but stays in Select mode", async () => {
    mockLibraryFetch([makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")]);
    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    const images = await screen.findAllByRole("img");
    fireEvent.click(screen.getByText("Select"));
    expect(screen.queryByRole("button", { name: "Deselect all" })).toBeNull();
    fireEvent.click(images[0]);
    expect(screen.getByText("1 Selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(screen.getByText("Select Items")).toBeInTheDocument();
    expect(screen.getByTestId("select-bar")).toBeInTheDocument();
  });

  it("hides the Years/Months/Days/All Photos pill in Select mode and restores it on Cancel", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    mockAssets(items);

    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    await screen.findAllByRole("img");
    expect(screen.getByRole("tablist", { name: "Library zoom" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Select"));
    expect(screen.queryByRole("tablist", { name: "Library zoom" })).toBeNull();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByRole("tablist", { name: "Library zoom" })).toBeInTheDocument();
  });

  it("falls back to download links per item when the Web Share API is unavailable", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")];
    mockAssets(items);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    const images = await screen.findAllByRole("img");
    fireEvent.click(screen.getByText("Select"));

    const a1Image = images.find((img) => img.getAttribute("src")?.includes("/thumb/a1?")) as HTMLImageElement;
    const a2Image = images.find((img) => img.getAttribute("src")?.includes("/thumb/a2?")) as HTMLImageElement;
    fireEvent.click(a1Image);
    fireEvent.click(a2Image);

    fireEvent.click(screen.getByText("Share"));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(2));
    clickSpy.mockRestore();
  });
});

describe("MobileLibrary summary failure (#147)", () => {
  it.each(["Years", "Months"])("shows an error and Retry in %s, then recovers", async (name) => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    let fail = true;
    mockFetch((url) => {
      if (url === "/api/libraries/1/summary") {
        return fail ? new Response("boom", { status: 500 }) : computeSummary(items);
      }
      if (url.match(/^\/api\/libraries\/1\/assets\?/)) return { items, next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<MobileLibrary libraryId={1} />);
    if (name === "Months") fireEvent.click(screen.getByRole("tab", { name: "Months" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your library.");
    expect(screen.queryByText("No photos yet.")).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("No photos yet.")).toBeNull();
  });
});

describe("MobileLibrary assets failure (#147)", () => {
  it.each(["Days", "All Photos"])("shows an error and Retry in %s instead of 'No photos yet.', then recovers", async (name) => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    let fail = true;
    mockFetch((url) => {
      if (url === "/api/libraries/1/summary") return computeSummary(items);
      if (url.match(/^\/api\/libraries\/1\/assets\?/)) {
        return fail ? new Response("boom", { status: 500 }) : { items, next_cursor: null };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    render(<MobileLibrary libraryId={1} />);
    fireEvent.click(screen.getByRole("tab", { name }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your library.");
    expect(screen.queryByText("No photos yet.")).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("No photos yet.")).toBeNull();
  });
});

describe("MobileLibrary later-page failure and empty library (#89)", () => {
  it("keeps loaded photos and shows Retry at the bottom when a later page fails", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00")];
    let fail = true;
    mockFetch((url) => {
      if (url === "/api/libraries/1/summary") return computeSummary(items);
      if (url.match(/^\/api\/libraries\/1\/assets\?/)) {
        if (!url.includes("cursor=")) return { items, next_cursor: "c1" };
        return fail ? new Response("boom", { status: 500 }) : { items: [makeItem("a2", "2024-05-09T10:00:00")], next_cursor: null };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    render(<MobileLibrary libraryId={1} />);
    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load more photos.");
    expect(queryThumb("a1")).not.toBeNull();
    expect(screen.queryByText("No photos yet.")).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await waitFor(() => expect(queryThumb("a2")).not.toBeNull());
  });

  it("still says 'No photos yet.' for an empty library", async () => {
    mockFetch((url) => {
      if (url === "/api/libraries/1/summary") return computeSummary([]);
      if (url.match(/^\/api\/libraries\/1\/assets\?/)) return { items: [], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<MobileLibrary libraryId={1} />);
    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    expect(await screen.findByText("No photos yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("MobileLibrary person grid text (#193)", () => {
  it("says 'person', not 'album', when a person has no photos", async () => {
    mockFetch((url) => {
      if (url.match(/^\/api\/libraries\/1\/assets\?/)) return { items: [], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<MobileLibrary libraryId={1} album="person:p1" />);
    expect(await screen.findByText("No photos of this person.")).toBeInTheDocument();
    expect(screen.queryByText("No photos in this album.")).toBeNull();
  });

  it("says 'person', not 'album', when a person's photos fail to load", async () => {
    mockFetch((url) => {
      if (url.match(/^\/api\/libraries\/1\/assets\?/)) return new Response("boom", { status: 500 });
      throw new Error(`unexpected request: ${url}`);
    });
    render(<MobileLibrary libraryId={1} album="person:p1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this person's photos.");
  });
});
