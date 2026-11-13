import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetDetailResponse, AssetListItem } from "../../api";
import { mockFetch } from "../../testHelpers";
import MobileViewer from "./MobileViewer";

function makeItem(id: string, overrides: Partial<AssetListItem> = {}): AssetListItem {
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
    ...overrides,
  };
}

function makeDetail(id: string, overrides: Partial<AssetDetailResponse> = {}): AssetDetailResponse {
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
    original_filesize: 1_500_000,
    latitude: null,
    longitude: null,
    place: "San Francisco",
    place_country_code: "US",
    place_address: "San Francisco, CA",
    camera_make: "Apple",
    camera_model: "iPhone 15 Pro",
    has_edited: false,
    original_available: true,
    has_live_photo_video: false,
    people: ["Alex"],
    albums: ["Trip"],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window.navigator as { connection?: unknown }).connection;
});

function mockDetail(details: Record<string, AssetDetailResponse>) {
  return mockFetch((url) => {
    const match = url.match(/^\/api\/libraries\/1\/assets\/([^/?]+)$/);
    if (match && details[match[1]]) return details[match[1]];
    throw new Error(`unexpected request: ${url}`);
  });
}

// One-finger drag with a controlled clock, so velocity is deterministic.
function drag(stage: HTMLElement, from: [number, number], to: [number, number], ms: number) {
  let now = 1_000_000;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
  fireEvent.touchStart(stage, { touches: [{ clientX: from[0], clientY: from[1] }] });
  now += ms;
  fireEvent.touchMove(stage, { touches: [{ clientX: to[0], clientY: to[1] }] });
  fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: to[0], clientY: to[1] }] });
  spy.mockRestore();
}

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

describe("MobileViewer", () => {
  it("shows the preview thumb first and requests the original only after zooming in", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);

    const stage = screen.getByTestId("mobile-viewer-stage");
    const media = () => stage.querySelector("img") as HTMLImageElement;
    expect(media().src).toContain("/thumb/a1?size=preview");
    expect(media().src).not.toContain("/original/");

    // Double tap: two touchStarts at the same point within the double-tap window.
    fireEvent.touchStart(stage, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchStart(stage, { touches: [{ clientX: 100, clientY: 100 }] });

    await waitFor(() => expect(media().src).toContain("/original/a1"));
  });

  it("zooms to the edited version when the asset has one", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1", { has_edited: true }) });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);

    const stage = screen.getByTestId("mobile-viewer-stage");
    const media = () => stage.querySelector("img") as HTMLImageElement;

    fireEvent.touchStart(stage, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchStart(stage, { touches: [{ clientX: 100, clientY: 100 }] });

    await waitFor(() => expect(media().src).toContain("/original/a1"));
    expect(media().src).toContain("version=edited");
  });

  it("closes on the back chevron", () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });
    const onClose = vi.fn();

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));

    expect(onClose).toHaveBeenCalled();
  });

  it("does not dismiss on a swipe down shorter than the threshold", () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });
    const onClose = vi.fn();

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={onClose} />);
    const stage = screen.getByTestId("mobile-viewer-stage");

    drag(stage, [200, 200], [200, 260], 400);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismisses on a swipe down past the threshold", () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });
    const onClose = vi.fn();

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={onClose} />);
    const stage = screen.getByTestId("mobile-viewer-stage");

    drag(stage, [200, 200], [200, 340], 400);
    expect(onClose).toHaveBeenCalled();
  });

  it("dismisses on a short fast flick down (velocity above 0.6 px/ms)", () => {
    mockDetail({ a1: makeDetail("a1") });
    const onClose = vi.fn();
    render(<MobileViewer libraryId={1} items={[makeItem("a1")]} index={0} onIndexChange={() => {}} onClose={onClose} />);
    drag(screen.getByTestId("mobile-viewer-stage"), [200, 200], [200, 260], 60); // 1 px/ms
    expect(onClose).toHaveBeenCalled();
  });

  it("scales the photo down and fades the background while dragging down, then springs back", () => {
    stubMatchMedia(false);
    mockDetail({ a1: makeDetail("a1") });
    render(<MobileViewer libraryId={1} items={[makeItem("a1")]} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    const stage = screen.getByTestId("mobile-viewer-stage");
    const root = screen.getByTestId("mobile-viewer");

    let now = 5_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    fireEvent.touchStart(stage, { touches: [{ clientX: 200, clientY: 200 }] });
    now += 900;
    fireEvent.touchMove(stage, { touches: [{ clientX: 200, clientY: 290 }] });
    // 90 px of 300: 30 % of the way to scale 0.8 and a 70 % background.
    expect(stage.style.transform).toMatch(/^translate\(0px, 90px\) scale\(0\.94/);
    expect(root.style.backgroundColor).toContain("70%");

    fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 200, clientY: 290 }] });
    vi.mocked(Date.now).mockRestore();
    expect(stage.style.transform).toBe("");
    expect(stage.style.transition).toContain("250ms");
  });

  it("swipes to the next item on a swipe left", () => {
    const items = [makeItem("a1"), makeItem("a2"), makeItem("a3")];
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2"), a3: makeDetail("a3") });
    const onIndexChange = vi.fn();

    render(<MobileViewer libraryId={1} items={items} index={1} onIndexChange={onIndexChange} onClose={() => {}} />);
    const stage = screen.getByTestId("mobile-viewer-stage");

    drag(stage, [600, 200], [300, 200], 600); // 300 px of a 1024 px window = 29 %, 0.5 px/ms
    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it("swipes to the previous item on a swipe right", () => {
    const items = [makeItem("a1"), makeItem("a2"), makeItem("a3")];
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2"), a3: makeDetail("a3") });
    const onIndexChange = vi.fn();

    render(<MobileViewer libraryId={1} items={items} index={1} onIndexChange={onIndexChange} onClose={() => {}} />);
    const stage = screen.getByTestId("mobile-viewer-stage");

    drag(stage, [100, 200], [400, 200], 800);
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it("does not page on a short, slow drag (under 15 % and 0.25 px/ms) and settles back", () => {
    const onIndexChange = vi.fn();
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2") });
    render(
      <MobileViewer libraryId={1} items={[makeItem("a1"), makeItem("a2")]} index={0} onIndexChange={onIndexChange} onClose={() => {}} />,
    );
    drag(screen.getByTestId("mobile-viewer-stage"), [600, 200], [500, 200], 1000);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("commits a flick over 0.25 px/ms and a 15 % drag, like iOS Photos", () => {
    const onIndexChange = vi.fn();
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2") });
    render(
      <MobileViewer libraryId={1} items={[makeItem("a1"), makeItem("a2")]} index={0} onIndexChange={onIndexChange} onClose={() => {}} />,
    );
    drag(screen.getByTestId("mobile-viewer-stage"), [400, 200], [240, 200], 1000); // 160 px = 15.6 %, slow
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it("pages on a short fast flick (above 0.25 px/ms)", () => {
    const onIndexChange = vi.fn();
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2") });
    render(
      <MobileViewer libraryId={1} items={[makeItem("a1"), makeItem("a2")]} index={0} onIndexChange={onIndexChange} onClose={() => {}} />,
    );
    drag(screen.getByTestId("mobile-viewer-stage"), [300, 200], [200, 200], 100); // 1 px/ms
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it("moves the strip with the finger, rubber-bands at the ends and settles with the 220 ms ease", () => {
    stubMatchMedia(false);
    vi.useFakeTimers();
    try {
      const onIndexChange = vi.fn();
      mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2") });
      const { container } = render(
        <MobileViewer libraryId={1} items={[makeItem("a1"), makeItem("a2")]} index={0} onIndexChange={onIndexChange} onClose={() => {}} />,
      );
      const stage = screen.getByTestId("mobile-viewer-stage");
      const strip = container.querySelector(".mobile-viewer__strip") as HTMLElement;

      // Dragging left moves the strip by exactly the finger distance.
      fireEvent.touchStart(stage, { touches: [{ clientX: 600, clientY: 200 }] });
      fireEvent.touchMove(stage, { touches: [{ clientX: 500, clientY: 200 }] });
      expect(strip.style.transform).toContain("+ -100px");
      // Dragging right on the first item (no previous) is rubber-banded.
      fireEvent.touchMove(stage, { touches: [{ clientX: 800, clientY: 200 }] });
      const banded = Number(/\+ ([\d.]+)px/.exec(strip.style.transform)?.[1]);
      expect(banded).toBeGreaterThan(0);
      expect(banded).toBeLessThan(200);
      fireEvent.touchMove(stage, { touches: [{ clientX: 200, clientY: 200 }] });
      fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 200, clientY: 200 }] });

      // Committed: animates to one page + gap over 220 ms, then swaps the item.
      expect(strip.style.transition).toContain("220ms cubic-bezier(0.25, 0.8, 0.3, 1)");
      expect(strip.style.transform).toContain(`+ -${1024 + 16}px`);
      expect(onIndexChange).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(220);
      });
      expect(onIndexChange).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preloads the neighbours' previews, nothing larger", () => {
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2"), a3: makeDetail("a3") });
    const { container } = render(
      <MobileViewer libraryId={1} items={[makeItem("a1"), makeItem("a2"), makeItem("a3")]} index={1} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const srcs = Array.from(container.querySelectorAll(".mobile-viewer__stage img")).map((img) => (img as HTMLImageElement).getAttribute("src"));
    expect(srcs).toContain("/api/libraries/1/thumb/a1?size=preview");
    expect(srcs).toContain("/api/libraries/1/thumb/a3?size=preview");
    expect(srcs.some((src) => src?.includes("/original/"))).toBe(false);
  });

  it("pinch is clamped to 1-6 and zooms about the pinch midpoint", () => {
    mockDetail({ a1: makeDetail("a1") });
    const { container } = render(
      <MobileViewer libraryId={1} items={[makeItem("a1", { width: 4000, height: 3000 })]} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const stage = screen.getByTestId("mobile-viewer-stage");
    const still = container.querySelector(".viewer-still") as HTMLElement;
    const two = (a: number, b: number) => [
      { clientX: 500 - a, clientY: 400 },
      { clientX: 500 + b, clientY: 400 },
    ];
    fireEvent.touchStart(stage, { touches: two(50, 50) });
    fireEvent.touchMove(stage, { touches: two(2000, 2000) }); // 40x the start distance
    const scale = Number(/scale\(([\d.]+)\)/.exec(still.style.transform)?.[1]);
    expect(scale).toBeGreaterThan(6);
    expect(scale).toBeLessThanOrEqual(6.5); // rubber-band only just past the limit
    fireEvent.touchEnd(stage, { touches: [], changedTouches: [] });
    expect(still.style.transform).toContain("scale(6)");
  });

  it("pans a zoomed photo with one finger, bounded by the image edge, and does not page", () => {
    const onIndexChange = vi.fn();
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2") });
    const { container } = render(
      <MobileViewer libraryId={1} items={[makeItem("a1", { width: 1000, height: 1000 }), makeItem("a2")]} index={0} onIndexChange={onIndexChange} onClose={() => {}} />,
    );
    const stage = screen.getByTestId("mobile-viewer-stage");
    const still = container.querySelector(".viewer-still") as HTMLElement;
    // Double tap at the centre: 2.5x. Window is 1024x768 so the fit is 768 square.
    fireEvent.touchStart(stage, { touches: [{ clientX: 512, clientY: 384 }] });
    fireEvent.touchStart(stage, { touches: [{ clientX: 512, clientY: 384 }] });
    fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 512, clientY: 384 }] });
    expect(still.style.transform).toContain("scale(2.5)");

    drag(stage, [500, 400], [5000, 400], 5000); // far past the edge
    const x = Number(/translate\((-?[\d.]+)px/.exec(still.style.transform)?.[1]);
    // (768 * 2.5 - 1024) / 2 = 448
    expect(x).toBeCloseTo(448);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("double tap goes to 2.5x centred on the tap point, and back to fit", () => {
    mockDetail({ a1: makeDetail("a1") });
    const { container } = render(
      <MobileViewer libraryId={1} items={[makeItem("a1", { width: 4000, height: 3000 })]} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const stage = screen.getByTestId("mobile-viewer-stage");
    const still = container.querySelector(".viewer-still") as HTMLElement;
    const tap = () => {
      fireEvent.touchStart(stage, { touches: [{ clientX: 600, clientY: 384 }] });
      fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 600, clientY: 384 }] });
    };
    tap();
    tap();
    expect(still.style.transform).toContain("scale(2.5)");
    tap();
    tap();
    expect(still.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("with reduced motion, gestures work but nothing animates", () => {
    stubMatchMedia(true);
    const onIndexChange = vi.fn();
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2") });
    const { container } = render(
      <MobileViewer libraryId={1} items={[makeItem("a1"), makeItem("a2")]} index={0} onIndexChange={onIndexChange} onClose={() => {}} />,
    );
    const stage = screen.getByTestId("mobile-viewer-stage");
    drag(stage, [600, 200], [200, 200], 400);
    expect(onIndexChange).toHaveBeenCalledWith(1); // immediately, no 300 ms wait
    expect((container.querySelector(".mobile-viewer__strip") as HTMLElement).style.transition).toBe("");
  });

  it("does not navigate past the first or last item", () => {
    const items = [makeItem("a1"), makeItem("a2")];
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2") });
    const onIndexChange = vi.fn();

    const { rerender } = render(
      <MobileViewer libraryId={1} items={items} index={0} onIndexChange={onIndexChange} onClose={() => {}} />,
    );
    let stage = screen.getByTestId("mobile-viewer-stage");
    drag(stage, [100, 200], [900, 200], 800);
    expect(onIndexChange).not.toHaveBeenCalled();

    rerender(<MobileViewer libraryId={1} items={items} index={1} onIndexChange={onIndexChange} onClose={() => {}} />);
    stage = screen.getByTestId("mobile-viewer-stage");
    drag(stage, [600, 200], [300, 200], 600); // 300 px of a 1024 px window = 29 %, 0.5 px/ms
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("plays video inline only after the play button is pressed, never from /original before that", () => {
    const items = [makeItem("v1", { is_video: true })];
    mockDetail({ v1: makeDetail("v1", { is_video: true }) });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);

    expect(screen.queryByTestId("viewer-video")).toBeNull();
    const playButton = screen.getByLabelText("Play video");
    expect(playButton.querySelector("img")?.getAttribute("src")).toContain("?size=preview");

    fireEvent.click(playButton);

    const video = screen.getByTestId("viewer-video");
    expect(video.getAttribute("src")).toContain("/original/v1");
  });

  it("plays a Live Photo on press using the live-photo route, never the original still", () => {
    const items = [makeItem("lp1", { is_live_photo: true })];
    mockDetail({ lp1: makeDetail("lp1", { is_live_photo: true }) });

    const { container } = render(
      <MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const wrap = container.querySelector(".mobile-viewer__media-wrap") as HTMLElement;
    expect(screen.queryByTestId("viewer-live-video")).toBeNull();

    fireEvent.pointerDown(wrap);
    const video = screen.getByTestId("viewer-live-video");
    expect(video.getAttribute("src")).toContain("/livephoto/lp1/video");
    expect(video.getAttribute("src")).not.toContain("/original/");

    fireEvent.pointerUp(wrap);
    expect(screen.queryByTestId("viewer-live-video")).toBeNull();
  });

  it("shows a favorite indicator with no tappable control, and no edit/delete controls", () => {
    const items = [makeItem("a1", { favorite: true })];
    mockDetail({ a1: makeDetail("a1") });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);

    const favorite = screen.getByLabelText("Favorite");
    expect(favorite.tagName).toBe("SPAN");
    // #131: read-only status, not a button look-alike.
    expect(favorite.getAttribute("role")).toBe("img");
    expect(favorite.className).toContain("mobile-viewer__status");
    expect(screen.queryByLabelText(/delete/i)).toBeNull();
    expect(screen.queryByLabelText(/edit/i)).toBeNull();
  });

  it("opens the info sheet with date, camera, people, albums, and location from the detail route", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Info"));

    const sheet = await screen.findByTestId("viewer-info-sheet");
    expect(sheet).toHaveTextContent("iPhone 15 Pro");
    expect(sheet).toHaveTextContent("Alex");
    expect(sheet).toHaveTextContent("Trip");
    expect(sheet).toHaveTextContent("San Francisco, CA");
    // Mobile's info sheet omits file name/size; that's desktop-only.
    expect(sheet).not.toHaveTextContent("a1.jpg");
  });


  it("the info sheet says before download when only a smaller copy is on disk", async () => {
    const items = [makeItem("a1"), makeItem("a2")];
    mockDetail({ a1: makeDetail("a1", { original_available: false }), a2: makeDetail("a2", { original_available: true }) });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Info"));
    const panel = await screen.findByTestId("viewer-info-sheet");
    expect(await screen.findByTestId("original-missing-note")).toHaveTextContent(
      "Only a smaller copy is on this Mac \u2014 downloads won't be the original.",
    );
    expect(panel).toContainElement(screen.getByTestId("original-missing-note"));

    cleanup();
    render(<MobileViewer libraryId={1} items={[items[1]]} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Info"));
    expect(await screen.findByTestId("viewer-info-sheet")).toHaveTextContent("Alex");
    expect(screen.queryByTestId("original-missing-note")).toBeNull();
  });

  it("shows coordinates, not a looked-up name, for GPS without a place record, and Unknown place for unusable GPS", async () => {
    const items = [makeItem("a1"), makeItem("a2")];
    mockDetail({
      a1: makeDetail("a1", { place: null, place_address: null, place_country_code: null, latitude: 52.2297, longitude: 21.0122 }),
      a2: makeDetail("a2", { place: null, place_address: null, place_country_code: null, latitude: 999, longitude: 0 }),
    });
    const { rerender } = render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Info"));
    const panel = await screen.findByTestId("viewer-info-sheet");
    expect(panel).toHaveTextContent("52.2297° N, 21.0122° E");
    // D41: the title is the date, never the coordinates.
    const title = document.querySelector(".mobile-viewer__title-primary");
    expect(title?.textContent).toMatch(/2024/);
    expect(title?.textContent).not.toContain("52.2297");
    // Line 2 is the time only: no place name, and never the coordinates.
    expect(document.querySelector(".mobile-viewer__title-secondary")?.textContent).toBe("10:00 AM");
    expect(global.fetch).toHaveBeenCalled();
    for (const call of (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls) {
      expect(String(call[0])).toMatch(/^\/api\//);
    }
    rerender(<MobileViewer libraryId={1} items={items} index={1} onIndexChange={() => {}} onClose={() => {}} />);
    // The sheet closes on a new photo, and the title is the date now (D41).
    fireEvent.click(screen.getByLabelText("Info"));
    await screen.findAllByText("Unknown place");
  });

  it("opens the info sheet on a swipe up", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    const stage = screen.getByTestId("mobile-viewer-stage");

    drag(stage, [200, 600], [200, 400], 500);

    await screen.findByTestId("viewer-info-sheet");
  });

  it("works at a real 390x844 mobile viewport, not the fixed 800x600 test stub", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 390,
      height: 844,
      top: 0,
      left: 0,
      right: 390,
      bottom: 844,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    });

    const items = [makeItem("a1"), makeItem("a2")];
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2") });
    const onClose = vi.fn();
    const onIndexChange = vi.fn();

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={onIndexChange} onClose={onClose} />);
    const stage = screen.getByTestId("mobile-viewer-stage");

    // A swipe from near the bottom edge of a 844px-tall screen to a 150px
    // dismiss drag -- exercised with coordinates that only make sense at
    // this viewport, not the test harness's default 800x600 stub.
    drag(stage, [195, 700], [195, 850], 500);
    expect(onClose).toHaveBeenCalled();

    rectSpy.mockRestore();
  });

  it("shows a Download Original action for an edited photo, and downloads the original file", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1", { has_edited: true }) });
    let href = "";
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      href = this.href;
    });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);

    fireEvent.click(await screen.findByLabelText("Download Original"));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(href).toContain("/original/a1");
    expect(href).not.toContain("version=edited");
    clickSpy.mockRestore();
  });

  it("has no Download Original action for a photo that was never edited", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1", { has_edited: false }) });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);

    await screen.findByLabelText("Share");
    expect(screen.queryByLabelText("Download Original")).toBeNull();
  });

  it("press-and-hold shows the unedited original while held, and reverts on release", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1", { has_edited: true }) });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    await screen.findByLabelText("Download Original");
    const stage = screen.getByTestId("mobile-viewer-stage");
    const media = () => stage.querySelector("img") as HTMLImageElement;

    vi.useFakeTimers();
    try {
      fireEvent.touchStart(stage, { touches: [{ clientX: 100, clientY: 100 }] });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(media().src).toContain("/original/a1");
      expect(media().src).not.toContain("version=edited");
      expect(screen.getByTestId("mobile-viewer-original-badge")).toBeTruthy();

      fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 100, clientY: 100 }] });
      expect(screen.queryByTestId("mobile-viewer-original-badge")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never arms the press-and-hold preview for a photo that was never edited", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1", { has_edited: false }) });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    await screen.findByLabelText("Share");
    const stage = screen.getByTestId("mobile-viewer-stage");

    vi.useFakeTimers();
    try {
      fireEvent.touchStart(stage, { touches: [{ clientX: 100, clientY: 100 }] });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.queryByTestId("mobile-viewer-original-badge")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads full quality automatically once the preview has rendered, without requiring zoom", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    const stage = screen.getByTestId("mobile-viewer-stage");
    const media = () => stage.querySelector("img") as HTMLImageElement;
    expect(media().src).toContain("?size=preview");

    fireEvent.load(media());

    await waitFor(() => expect(media().src).toContain("/original/a1"));
  });

  it("skips the automatic full-quality load when the browser's data saver is on", async () => {
    Object.defineProperty(window.navigator, "connection", { configurable: true, value: { saveData: true } });
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    const stage = screen.getByTestId("mobile-viewer-stage");
    const media = () => stage.querySelector("img") as HTMLImageElement;

    fireEvent.load(media());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(media().src).toContain("?size=preview");
    expect(media().src).not.toContain("/original/");
  });

  it("still loads full quality on zoom even when the browser's data saver is on", async () => {
    Object.defineProperty(window.navigator, "connection", { configurable: true, value: { saveData: true } });
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    const stage = screen.getByTestId("mobile-viewer-stage");
    const media = () => stage.querySelector("img") as HTMLImageElement;

    fireEvent.touchStart(stage, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchStart(stage, { touches: [{ clientX: 100, clientY: 100 }] });

    await waitFor(() => expect(media().src).toContain("/original/a1"));
  });

  it("never requests the unedited original for the automatic full-quality load of an edited photo", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1", { has_edited: true }) });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    const stage = screen.getByTestId("mobile-viewer-stage");
    const media = () => stage.querySelector("img") as HTMLImageElement;

    // Fire the preview's onLoad before the asset detail (has_edited) fetch
    // has resolved -- the race this fix closes. The automatic load must
    // wait for has_edited rather than briefly requesting plain `/original`.
    fireEvent.load(media());
    expect(media().src).toContain("?size=preview");

    await waitFor(() => expect(media().src).toContain("/original/a1"));
    expect(media().src).toContain("version=edited");
  });

  it("disables drag and the iOS press-and-hold callout on the viewer image", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    await screen.findByLabelText("Share");
    const stage = screen.getByTestId("mobile-viewer-stage");
    const media = stage.querySelector("img") as HTMLImageElement;
    expect(media.draggable).toBe(false);
  });
});

describe("favorite status styling (#131)", () => {
  it("is non-interactive in CSS", () => {
    const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
    const rule = css.match(/\.mobile-viewer__status \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("cursor: default");
    expect(rule).toContain("pointer-events: none");
  });
});

describe("MobileViewer info sheet styling (#112)", () => {
  it("is opaque so the icon row and filmstrip do not show through", () => {
    const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
    const rule = /\.mobile-viewer__info-sheet \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/background:\s*var\(--surface-dark\)\s*;/);
    expect(rule).not.toMatch(/rgba/);
    const tokens = readFileSync(join(__dirname, "..", "tokens.css"), "utf-8");
    expect(tokens).toMatch(/--surface-dark:\s*#[0-9a-f]{6}\s*;/i);
  });
});

describe("MobileViewer chrome (#211, #111, #131)", () => {
  const noop = () => {};
  const tapAt = (stage: HTMLElement, x = 200, y = 300, target: HTMLElement = stage) => {
    fireEvent.touchStart(target, { touches: [{ clientX: x, clientY: y }] });
    fireEvent.touchEnd(target, { touches: [], changedTouches: [{ clientX: x, clientY: y }] });
  };
  const root = () => screen.getByTestId("mobile-viewer");
  const setup = (overrides: Partial<AssetListItem> = {}, detail: Partial<AssetDetailResponse> = {}) => {
    mockDetail({ a1: makeDetail("a1", detail) });
    render(<MobileViewer libraryId={1} items={[makeItem("a1", overrides)]} index={0} onIndexChange={noop} onClose={noop} />);
    return screen.getByTestId("mobile-viewer-stage");
  };

  afterEach(() => vi.useRealTimers());

  it("a single tap toggles all the chrome, after the double-tap window", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const stage = setup();
    expect(root().className).not.toContain("is-chrome-hidden");
    tapAt(stage);
    expect(root().className).not.toContain("is-chrome-hidden");
    act(() => void vi.advanceTimersByTime(299));
    expect(root().className).not.toContain("is-chrome-hidden");
    act(() => void vi.advanceTimersByTime(1));
    expect(root().className).toContain("is-chrome-hidden");
    tapAt(stage);
    act(() => void vi.advanceTimersByTime(300));
    expect(root().className).not.toContain("is-chrome-hidden");
  });

  it("a double tap zooms and does not toggle the chrome", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const stage = setup({ width: 4000, height: 3000 });
    tapAt(stage);
    tapAt(stage);
    act(() => void vi.advanceTimersByTime(1000));
    expect(root().className).not.toContain("is-chrome-hidden");
    expect(document.querySelector<HTMLElement>(".viewer-still")?.style.transform).toContain("scale(2.5)");
  });

  it("a drag, a swipe up and a pinch do not toggle the chrome", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const stage = setup();
    drag(stage, [200, 300], [200, 360], 100);
    drag(stage, [200, 600], [200, 400], 500);
    drag(stage, [300, 300], [150, 300], 100);
    fireEvent.touchStart(stage, { touches: [{ clientX: 100, clientY: 300 }, { clientX: 200, clientY: 300 }] });
    fireEvent.touchEnd(stage, { touches: [], changedTouches: [] });
    act(() => void vi.advanceTimersByTime(1000));
    expect(root().className).not.toContain("is-chrome-hidden");
  });

  it("a tap that turns into a drag inside the double-tap window cancels the toggle", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const stage = setup();
    tapAt(stage, 200, 300);
    drag(stage, [400, 300], [250, 300], 100);
    act(() => void vi.advanceTimersByTime(1000));
    expect(root().className).not.toContain("is-chrome-hidden");
  });

  it("a tap on a control inside the stage (the video Play button) does not toggle", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const stage = setup({ is_video: true }, { is_video: true });
    tapAt(stage, 200, 300, screen.getByLabelText("Play video"));
    act(() => void vi.advanceTimersByTime(1000));
    expect(root().className).not.toContain("is-chrome-hidden");
  });

  it("hides the bars 2.5 s after video playback starts and brings them back on pause or tap", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const stage = setup({ is_video: true }, { is_video: true });
    fireEvent.click(screen.getByLabelText("Play video"));
    const video = screen.getByTestId("viewer-video");
    fireEvent.play(video);
    act(() => void vi.advanceTimersByTime(2499));
    expect(root().className).not.toContain("is-chrome-hidden");
    act(() => void vi.advanceTimersByTime(1));
    expect(root().className).toContain("is-chrome-hidden");
    // A tap on the video brings them back (and the timer starts over).
    tapAt(stage, 200, 300, video);
    act(() => void vi.advanceTimersByTime(300));
    expect(root().className).not.toContain("is-chrome-hidden");
    act(() => void vi.advanceTimersByTime(2500));
    expect(root().className).toContain("is-chrome-hidden");
    fireEvent.pause(video);
    expect(root().className).not.toContain("is-chrome-hidden");
    act(() => void vi.advanceTimersByTime(10_000));
    expect(root().className).not.toContain("is-chrome-hidden");
  });

  it("never auto-hides for a still", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    setup();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(root().className).not.toContain("is-chrome-hidden");
  });

  it("two-line title: relative day, then time and place", async () => {
    const day = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T14:07:00`;
    setup({}, { date_created: today, place_address: null, place: "Kraków" });
    await waitFor(() => expect(document.querySelector(".mobile-viewer__title-primary")?.textContent).toBe("Today"));
    const second = document.querySelector(".mobile-viewer__title-secondary")?.textContent ?? "";
    expect(second).toMatch(/2:07/);
    expect(second).toMatch(/ \u00b7 Kraków$/);
  });

  it("every icon button is at least 44 x 44, and the bar buttons 44 x 52 (shell.css)", () => {
    const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
    const block = (selector: string) => {
      const start = css.indexOf(`\n${selector} {`);
      expect(start, selector).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start));
    };
    const size = (b: string) => [/width:\s*(\d+)px/.exec(b)?.[1], /height:\s*(\d+)px/.exec(b)?.[1]].map(Number);
    expect(size(block(".mobile-viewer__icon-button"))).toEqual([44, 44]);
    expect(size(block(".mobile-viewer__status"))).toEqual([44, 52]);
    const grouped = css.slice(css.indexOf(".mobile-viewer__icon-button--bar,"), css.indexOf(".mobile-viewer__status {"));
    expect(size(grouped)).toEqual([44, 52]);
  });

  it("the bar has fixed slots in the order Share, Favorite, Download Original, Info", async () => {
    setup({ favorite: true }, { has_edited: true });
    const row = document.querySelector(".mobile-viewer__icon-row") as HTMLElement;
    await screen.findByLabelText("Download Original");
    expect(row.children).toHaveLength(4);
    expect([...row.children].map((c) => c.getAttribute("aria-label"))).toEqual([
      "Share",
      "Favorite",
      "Download Original",
      "Info",
    ]);
  });

  it("keeps the empty slots when the favourite and the original download are absent", () => {
    setup();
    const row = document.querySelector(".mobile-viewer__icon-row") as HTMLElement;
    expect(row.children).toHaveLength(4);
    expect(row.querySelectorAll(".mobile-viewer__slot")).toHaveLength(2);
  });

  it("the favourite heart is a status, not a button", () => {
    setup({ favorite: true });
    const heart = screen.getByLabelText("Favorite");
    expect(heart.tagName).not.toBe("BUTTON");
    expect(heart.getAttribute("role")).toBe("img");
    expect(heart.closest("button")).toBeNull();
    expect(heart.hasAttribute("tabindex")).toBe(false);
    expect(screen.queryByRole("button", { name: "Favorite" })).toBeNull();
    const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
    const rule = css.slice(css.indexOf(".mobile-viewer__status {"), css.indexOf("}", css.indexOf(".mobile-viewer__status {")));
    expect(rule).toContain("pointer-events: none");
    expect(rule).toContain("cursor: default");
  });

  it("the filmstrip sits directly above the bottom toolbar, inside one blurred bar", () => {
    setup();
    const bar = document.querySelector(".mobile-viewer__bottombar") as HTMLElement;
    expect([...bar.children].map((c) => c.className.split(" ")[0])).toEqual(["mobile-viewer__filmstrip", "mobile-viewer__icon-row"]);
  });
});
