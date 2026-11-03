import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetListItem } from "../../api";
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
});
