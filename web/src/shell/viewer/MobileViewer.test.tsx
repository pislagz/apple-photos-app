import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

    fireEvent.touchStart(stage, { touches: [{ clientX: 200, clientY: 200 }] });
    fireEvent.touchMove(stage, { touches: [{ clientX: 200, clientY: 260 }] });
    fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 200, clientY: 260 }] });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismisses on a swipe down past the threshold", () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });
    const onClose = vi.fn();

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={onClose} />);
    const stage = screen.getByTestId("mobile-viewer-stage");

    fireEvent.touchStart(stage, { touches: [{ clientX: 200, clientY: 200 }] });
    fireEvent.touchMove(stage, { touches: [{ clientX: 200, clientY: 340 }] });
    fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 200, clientY: 340 }] });
    expect(onClose).toHaveBeenCalled();
  });

  it("swipes to the next item on a swipe left", () => {
    const items = [makeItem("a1"), makeItem("a2"), makeItem("a3")];
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2"), a3: makeDetail("a3") });
    const onIndexChange = vi.fn();

    render(<MobileViewer libraryId={1} items={items} index={1} onIndexChange={onIndexChange} onClose={() => {}} />);
    const stage = screen.getByTestId("mobile-viewer-stage");

    fireEvent.touchStart(stage, { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchMove(stage, { touches: [{ clientX: 180, clientY: 200 }] });
    fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 180, clientY: 200 }] });
    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it("swipes to the previous item on a swipe right", () => {
    const items = [makeItem("a1"), makeItem("a2"), makeItem("a3")];
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2"), a3: makeDetail("a3") });
    const onIndexChange = vi.fn();

    render(<MobileViewer libraryId={1} items={items} index={1} onIndexChange={onIndexChange} onClose={() => {}} />);
    const stage = screen.getByTestId("mobile-viewer-stage");

    fireEvent.touchStart(stage, { touches: [{ clientX: 100, clientY: 200 }] });
    fireEvent.touchMove(stage, { touches: [{ clientX: 220, clientY: 200 }] });
    fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 220, clientY: 200 }] });
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it("does not navigate past the first or last item", () => {
    const items = [makeItem("a1"), makeItem("a2")];
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2") });
    const onIndexChange = vi.fn();

    const { rerender } = render(
      <MobileViewer libraryId={1} items={items} index={0} onIndexChange={onIndexChange} onClose={() => {}} />,
    );
    let stage = screen.getByTestId("mobile-viewer-stage");
    fireEvent.touchStart(stage, { touches: [{ clientX: 100, clientY: 200 }] });
    fireEvent.touchMove(stage, { touches: [{ clientX: 220, clientY: 200 }] });
    fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 220, clientY: 200 }] });
    expect(onIndexChange).not.toHaveBeenCalled();

    rerender(<MobileViewer libraryId={1} items={items} index={1} onIndexChange={onIndexChange} onClose={() => {}} />);
    stage = screen.getByTestId("mobile-viewer-stage");
    fireEvent.touchStart(stage, { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchMove(stage, { touches: [{ clientX: 180, clientY: 200 }] });
    fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 180, clientY: 200 }] });
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

  it("opens the info sheet on a swipe up", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });

    render(<MobileViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    const stage = screen.getByTestId("mobile-viewer-stage");

    fireEvent.touchStart(stage, { touches: [{ clientX: 200, clientY: 600 }] });
    fireEvent.touchMove(stage, { touches: [{ clientX: 200, clientY: 400 }] });
    fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 200, clientY: 400 }] });

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
    fireEvent.touchStart(stage, { touches: [{ clientX: 195, clientY: 700 }] });
    fireEvent.touchMove(stage, { touches: [{ clientX: 195, clientY: 850 }] });
    fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 195, clientY: 850 }] });
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
});
