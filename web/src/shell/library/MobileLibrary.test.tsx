import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetListItem } from "../../api";
import { mockFetch } from "../../testHelpers";
import MobileLibrary from "./MobileLibrary";

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
    expect(container.querySelectorAll(".mobile-library__row-header").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "All Photos" }));
    expect(screen.getByRole("tab", { name: "All Photos" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(container.querySelectorAll(".mobile-library__row-header").length).toBe(0));
    expect(container.querySelectorAll(".mobile-library__row-grid").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "Months" }));
    await waitFor(() => expect(container.querySelectorAll(".mobile-library__row-header").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("tab", { name: "Days" }));
    await waitFor(() => expect(container.querySelectorAll(".mobile-library__row-feature").length).toBeGreaterThan(0));
  });

  it("updates the pinned date header to the topmost visible group while scrolling", async () => {
    const items = [
      makeItem("may-1", "2024-05-10T10:00:00"),
      makeItem("may-2", "2024-05-09T10:00:00"),
      ...Array.from({ length: 20 }, (_, i) => makeItem(`apr-${i}`, `2024-04-${String(20 - i).padStart(2, "0")}T10:00:00`)),
    ];
    mockAssets(items);

    render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");
    fireEvent.click(screen.getByRole("tab", { name: "Months" }));
    await waitFor(() => expect(screen.getByTestId("pinned-header")).toHaveTextContent("May 2024"));

    const scrollEl = screen.getByTestId("library-scroll");
    // Header row (32px) + one grid row (cellSize 200px with the mocked
    // 800px-wide container / 4 columns) comfortably clears May's single row.
    scrollEl.scrollTop = 260;
    fireEvent.scroll(scrollEl);

    await waitFor(() => expect(screen.getByTestId("pinned-header")).toHaveTextContent("April 2024"));
  });

  it("changes the column count on a pinch gesture", async () => {
    const items = Array.from({ length: 12 }, (_, i) => makeItem(`p${i}`, `2024-05-${String(20 - i).padStart(2, "0")}T10:00:00`));
    mockAssets(items);

    const { container } = render(<MobileLibrary libraryId={1} />);
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

  it("opens the Viewer on tap, at the tapped item's position, and closing it restores the grid", async () => {
    const items = [makeItem("a1", "2024-05-10T10:00:00"), makeItem("a2", "2024-05-09T10:00:00")];
    mockFetch((url) => {
      if (url.match(/^\/api\/libraries\/1\/assets\?/)) return { items, next_cursor: null };
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
      throw new Error(`unexpected request: ${url}`);
    });

    render(<MobileLibrary libraryId={1} />);
    const images = await screen.findAllByRole("img");
    const a2Image = images.find((img) => img.getAttribute("alt") === "a2.jpg");
    fireEvent.click(a2Image as HTMLImageElement);

    const viewer = await screen.findByTestId("mobile-viewer");
    expect(viewer.querySelector("img")?.getAttribute("src")).toContain("a2");

    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByTestId("mobile-viewer")).toBeNull();
    expect(screen.getByTestId("library-scroll")).toBeInTheDocument();
  });

  it("keeps a hidden asset out of Years, Months, Days, and All Photos", async () => {
    // The server already excludes hidden assets from `/assets`; this fixture
    // mirrors that by keeping "hidden-1" out of the `/assets` page while
    // still serving it from `/hidden`, so the test fails if the component
    // ever falls back to that endpoint or otherwise surfaces the id.
    const visible = [makeItem("v1", "2024-05-10T10:00:00"), makeItem("v2", "2024-05-09T10:00:00")];
    const hidden = makeItem("hidden-1", "2024-05-08T10:00:00");
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets")) return { items: visible, next_cursor: null };
      if (url.startsWith("/api/libraries/1/hidden")) return { items: [hidden], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });

    const { container } = render(<MobileLibrary libraryId={1} />);
    await screen.findAllByRole("img");

    for (const view of ["Years", "Months", "Days", "All Photos"]) {
      fireEvent.click(screen.getByRole("tab", { name: view }));
      await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThan(0));
      expect(container.innerHTML).not.toContain("hidden-1");
    }
  });
});
