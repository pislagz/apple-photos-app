import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetDetailResponse, AssetListItem } from "../../api";
import { mockFetch } from "../../testHelpers";
import DesktopViewer from "./DesktopViewer";

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
    original_filesize: 2_400_000,
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
});

function mockDetail(details: Record<string, AssetDetailResponse>) {
  return mockFetch((url) => {
    const match = url.match(/^\/api\/libraries\/1\/assets\/([^/?]+)$/);
    if (match && details[match[1]]) return details[match[1]];
    throw new Error(`unexpected request: ${url}`);
  });
}

describe("DesktopViewer", () => {
  it("shows the preview thumb first and requests the original only after a double-click zoom", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });

    const { container } = render(
      <DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const media = () => container.querySelector(".desktop-viewer__media") as HTMLImageElement;
    expect(media().src).toContain("/thumb/a1?size=preview");
    expect(media().src).not.toContain("/original/");

    fireEvent.doubleClick(media());

    await waitFor(() => expect(media().src).toContain("/original/a1"));
  });

  it("closes on Escape", () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });
    const onClose = vi.fn();

    render(<DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId("desktop-viewer"), { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on the toolbar close button", () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });
    const onClose = vi.fn();

    render(<DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));

    expect(onClose).toHaveBeenCalled();
  });

  it("navigates with arrow keys but stops at the bounds", () => {
    const items = [makeItem("a1"), makeItem("a2"), makeItem("a3")];
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2"), a3: makeDetail("a3") });
    const onIndexChange = vi.fn();

    const { rerender } = render(
      <DesktopViewer libraryId={1} items={items} index={0} onIndexChange={onIndexChange} onClose={() => {}} />,
    );
    const root = screen.getByTestId("desktop-viewer");

    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(onIndexChange).not.toHaveBeenCalled();

    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenCalledWith(1);

    onIndexChange.mockClear();
    rerender(<DesktopViewer libraryId={1} items={items} index={2} onIndexChange={onIndexChange} onClose={() => {}} />);
    fireEvent.keyDown(screen.getByTestId("desktop-viewer"), { key: "ArrowRight" });
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("plays video inline only after the play button is clicked", () => {
    const items = [makeItem("v1", { is_video: true })];
    mockDetail({ v1: makeDetail("v1", { is_video: true }) });

    render(<DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);

    expect(screen.queryByTestId("viewer-video")).toBeNull();
    fireEvent.click(screen.getByLabelText("Play video"));

    const video = screen.getByTestId("viewer-video");
    expect(video.getAttribute("src")).toContain("/original/v1");
  });

  it("keeps Esc and arrow keys working after the play button unmounts and focus falls to body", () => {
    const items = [makeItem("v1", { is_video: true }), makeItem("v2", { is_video: true })];
    mockDetail({ v1: makeDetail("v1", { is_video: true }), v2: makeDetail("v2", { is_video: true }) });
    const onClose = vi.fn();
    const onIndexChange = vi.fn();

    render(
      <DesktopViewer libraryId={1} items={items} index={0} onIndexChange={onIndexChange} onClose={onClose} />,
    );

    fireEvent.click(screen.getByLabelText("Play video"));
    expect(screen.getByTestId("viewer-video")).toBeTruthy();

    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenCalledWith(1);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("plays a Live Photo on hover using the live-photo route, never the original still", () => {
    const items = [makeItem("lp1", { is_live_photo: true })];
    mockDetail({ lp1: makeDetail("lp1", { is_live_photo: true }) });

    const { container } = render(
      <DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const wrap = container.querySelector(".desktop-viewer__media-wrap") as HTMLElement;
    expect(screen.queryByTestId("viewer-live-video")).toBeNull();

    fireEvent.mouseEnter(wrap);
    const video = screen.getByTestId("viewer-live-video");
    expect(video.getAttribute("src")).toContain("/livephoto/lp1/video");
    expect(video.getAttribute("src")).not.toContain("/original/");

    fireEvent.mouseLeave(wrap);
    expect(screen.queryByTestId("viewer-live-video")).toBeNull();
  });

  it("shows the info panel with date, camera, people, albums, location, file name, and size", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });

    render(<DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Info"));

    const panel = await screen.findByTestId("viewer-info-panel");
    expect(panel).toHaveTextContent("iPhone 15 Pro");
    expect(panel).toHaveTextContent("Alex");
    expect(panel).toHaveTextContent("Trip");
    expect(panel).toHaveTextContent("San Francisco, CA");
    expect(panel).toHaveTextContent("a1.jpg");
    expect(panel).toHaveTextContent("2.3 MB");
  });

  it("downloads the original only on an explicit click, not before", () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    expect(clickSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Download"));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it("has no edit, delete, or favorite-write controls", () => {
    const items = [makeItem("a1", { favorite: true })];
    mockDetail({ a1: makeDetail("a1") });

    render(<DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);

    expect(screen.queryByLabelText(/delete/i)).toBeNull();
    expect(screen.queryByLabelText(/edit/i)).toBeNull();
    expect(screen.queryByLabelText(/favorite/i)).toBeNull();
  });

  it("works at a real 1440x900 desktop viewport, not the fixed 800x600 test stub", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1440,
      height: 900,
      top: 0,
      left: 0,
      right: 1440,
      bottom: 900,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    });

    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });

    const { container } = render(
      <DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const media = container.querySelector(".desktop-viewer__media") as HTMLImageElement;
    fireEvent.doubleClick(media);

    // Pan drag using coordinates up to the 1440px-wide viewport's edge --
    // only meaningful at this viewport, not the harness's default 800x600.
    fireEvent.mouseDown(screen.getByTestId("desktop-viewer-stage").querySelector("img") as HTMLImageElement, {
      clientX: 1400,
      clientY: 850,
    });
    fireEvent.mouseMove(screen.getByTestId("desktop-viewer-stage"), { clientX: 1300, clientY: 800 });
    fireEvent.mouseUp(screen.getByTestId("desktop-viewer-stage"));

    await waitFor(() => expect(media.src).toContain("/original/a1"));
    rectSpy.mockRestore();
  });
});
