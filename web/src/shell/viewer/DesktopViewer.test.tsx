import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    original_available: true,
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

  it("closes on the toolbar back button", () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });
    const onClose = vi.fn();

    render(<DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Back"));

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


  it("says the original is stored outside the library and never requests /original (#78)", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1", { original_outside_library: true }) });

    render(<DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);

    expect(await screen.findByTestId("original-outside-note")).toHaveTextContent(
      "The original is stored outside the library and isn't available.",
    );
    fireEvent.load(screen.getAllByRole("img")[0]);
    const still = screen.getAllByRole("img").find((img) => img.getAttribute("src")?.includes("/thumb/a1"));
    expect(still).toBeTruthy();
    expect(document.querySelector('img[src*="/original/"]')).toBeNull();
  });

  it("the info panel says before download when only a smaller copy is on disk", async () => {
    const items = [makeItem("a1"), makeItem("a2")];
    mockDetail({ a1: makeDetail("a1", { original_available: false }), a2: makeDetail("a2", { original_available: true }) });

    render(<DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Info"));
    const panel = await screen.findByTestId("viewer-info-panel");
    expect(await screen.findByTestId("original-missing-note")).toHaveTextContent(
      "Only a smaller copy is on this Mac \u2014 downloads won't be the original.",
    );
    expect(panel).toContainElement(screen.getByTestId("original-missing-note"));

    cleanup();
    render(<DesktopViewer libraryId={1} items={[items[1]]} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Info"));
    expect(await screen.findByTestId("viewer-info-panel")).toHaveTextContent("Alex");
    expect(screen.queryByTestId("original-missing-note")).toBeNull();
  });

  it("shows coordinates, not a looked-up name, for GPS without a place record, and Unknown place for unusable GPS", async () => {
    const items = [makeItem("a1"), makeItem("a2")];
    mockDetail({
      a1: makeDetail("a1", { place: null, place_address: null, place_country_code: null, latitude: 52.2297, longitude: 21.0122 }),
      a2: makeDetail("a2", { place: null, place_address: null, place_country_code: null, latitude: 999, longitude: 0 }),
    });
    const { rerender } = render(<DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Info"));
    const panel = await screen.findByTestId("viewer-info-panel");
    expect(panel).toHaveTextContent("52.2297° N, 21.0122° E");
    // D41: the title is never the coordinates nor a file name; line 1 is
    // "date at time", line 2 the position.
    const title = document.querySelector(".desktop-viewer__title-primary");
    expect(title?.textContent).toMatch(/2024/);
    expect(title?.textContent).not.toContain("a1.jpg");
    expect(title?.textContent).not.toContain("52.2297");
    const line = document.querySelector(".desktop-viewer__title-secondary")?.textContent;
    expect(line).toBe("1 of 2");
    expect(global.fetch).toHaveBeenCalled();
    for (const call of (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls) {
      expect(String(call[0])).toMatch(/^\/api\//);
    }
    rerender(<DesktopViewer libraryId={1} items={items} index={1} onIndexChange={() => {}} onClose={() => {}} />);
    await screen.findAllByText("Unknown place");
  });

  it("downloads the original only on an explicit click, not before", () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });
    let downloadHref = "";
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadHref = this.href;
    });

    const { container } = render(
      <DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const media = container.querySelector(".desktop-viewer__media") as HTMLImageElement;
    expect(clickSpy).not.toHaveBeenCalled();
    expect(media.src).not.toContain("download=1");

    fireEvent.click(screen.getByLabelText("Download"));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    // The explicit Download click carries the audit marker; the zoomed-in
    // `<img>` src the viewer may already be showing never does.
    expect(downloadHref).toContain("download=1");
    expect(media.src).not.toContain("download=1");
    clickSpy.mockRestore();
  });

  it("zooms and downloads the edited version when the asset has one, and offers Download Original", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1", { has_edited: true }) });
    let downloadHref = "";
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadHref = this.href;
    });

    const { container } = render(
      <DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const media = () => container.querySelector(".desktop-viewer__media") as HTMLImageElement;
    await screen.findByLabelText("Download Original");

    fireEvent.doubleClick(media());
    await waitFor(() => expect(media().src).toContain("/original/a1"));
    expect(media().src).toContain("version=edited");

    fireEvent.click(screen.getByLabelText("Download"));
    expect(downloadHref).toContain("version=edited");

    fireEvent.click(screen.getByLabelText("Download Original"));
    expect(downloadHref).not.toContain("version=edited");
    clickSpy.mockRestore();
  });

  it("has no Download Original button when the asset has no edited version", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1", { has_edited: false }) });

    render(<DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);

    await screen.findByLabelText("Download");
    expect(screen.queryByLabelText("Download Original")).toBeNull();
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

  it("toggles Show Original to the unedited file and back, only for an edited photo", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1", { has_edited: true }) });

    const { container } = render(
      <DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const media = () => container.querySelector(".desktop-viewer__media") as HTMLImageElement;
    const toggle = await screen.findByLabelText("Show Original");

    fireEvent.click(toggle);
    expect(media().src).toContain("/original/a1");
    expect(media().src).not.toContain("version=edited");
    expect(media().src).not.toContain("download=1");

    fireEvent.click(toggle);
    expect(media().src).not.toContain("/original/a1");
  });

  it("has no Show Original toggle when the asset has no edited version", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1", { has_edited: false }) });

    render(<DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />);

    await screen.findByLabelText("Download");
    expect(screen.queryByLabelText("Show Original")).toBeNull();
  });

  it("loads full quality automatically once the preview has rendered, without requiring a zoom", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1") });

    const { container } = render(
      <DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const media = () => container.querySelector(".desktop-viewer__media") as HTMLImageElement;
    expect(media().src).toContain("?size=preview");

    fireEvent.load(media());

    await waitFor(() => expect(media().src).toContain("/original/a1"));
  });

  it("skips the automatic full-quality load when the browser's data saver is on, but zoom still loads it", async () => {
    Object.defineProperty(window.navigator, "connection", { configurable: true, value: { saveData: true } });
    try {
      const items = [makeItem("a1")];
      mockDetail({ a1: makeDetail("a1") });

      const { container } = render(
        <DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />,
      );
      const media = () => container.querySelector(".desktop-viewer__media") as HTMLImageElement;

      fireEvent.load(media());
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(media().src).not.toContain("/original/");

      fireEvent.doubleClick(media());
      await waitFor(() => expect(media().src).toContain("/original/a1"));
    } finally {
      delete (window.navigator as { connection?: unknown }).connection;
    }
  });

  it("never requests the unedited original for the automatic full-quality load of an edited photo", async () => {
    const items = [makeItem("a1")];
    mockDetail({ a1: makeDetail("a1", { has_edited: true }) });

    const { container } = render(
      <DesktopViewer libraryId={1} items={items} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const media = () => container.querySelector(".desktop-viewer__media") as HTMLImageElement;

    // Fire onLoad before the asset detail (has_edited) fetch resolves --
    // the automatic load must wait for it instead of briefly requesting
    // plain `/original`.
    fireEvent.load(media());
    expect(media().src).toContain("?size=preview");

    await waitFor(() => expect(media().src).toContain("/original/a1"));
    expect(media().src).toContain("version=edited");
  });

  it("zooms with ctrl+wheel (clamped to 6x), double-click goes to 2.5x, and drag pans within bounds", () => {
    mockDetail({ a1: makeDetail("a1") });
    const { container } = render(
      <DesktopViewer libraryId={1} items={[makeItem("a1", { width: 1000, height: 1000 })]} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const stage = screen.getByTestId("desktop-viewer-stage");
    const still = container.querySelector(".viewer-still") as HTMLElement;

    // A plain wheel scrolls/does nothing; only ctrl+wheel (trackpad pinch) zooms.
    fireEvent.wheel(stage, { deltaY: -50 });
    expect(still.style.transform).toContain("scale(1)");
    fireEvent.wheel(stage, { deltaY: -10_000, ctrlKey: true });
    expect(still.style.transform).toContain("scale(6)");
    fireEvent.wheel(stage, { deltaY: 10_000, ctrlKey: true });
    expect(still.style.transform).toContain("scale(1)");

    fireEvent.doubleClick(still);
    expect(still.style.transform).toContain("scale(2.5)");
    fireEvent.mouseDown(still, { clientX: 500, clientY: 400 });
    fireEvent.mouseMove(stage, { clientX: -9000, clientY: 400 });
    fireEvent.mouseUp(stage);
    const x = Number(/translate\((-?[\d.]+)px/.exec(still.style.transform)?.[1]);
    const fit = Math.min(window.innerWidth, window.innerHeight); // square photo, no layout in jsdom
    expect(x).toBeCloseTo(-(fit * 2.5 - window.innerWidth) / 2);
    fireEvent.doubleClick(still);
    expect(still.style.transform).toBe("translate(0px, 0px) scale(1)");
  });
});

describe("DesktopViewer fit, zoom and pan (#267)", () => {
  const items = [makeItem("a1", { width: 4000, height: 3000 }), makeItem("a2"), makeItem("a3")];
  function setup(index = 1) {
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2"), a3: makeDetail("a3") });
    const onIndexChange = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <DesktopViewer libraryId={1} items={items} index={index} onIndexChange={onIndexChange} onClose={onClose} />,
    );
    const still = container.querySelector(".viewer-still") as HTMLElement;
    return { still, onIndexChange, onClose };
  }
  function drag(still: HTMLElement, from: [number, number], to: [number, number]) {
    fireEvent.mouseDown(still, { clientX: from[0], clientY: from[1] });
    fireEvent.mouseMove(window, { clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2 });
    fireEvent.mouseMove(window, { clientX: to[0], clientY: to[1] });
    fireEvent.mouseUp(window, { clientX: to[0], clientY: to[1] });
  }

  it("lays the still out in a 0-min grid track so it cannot outgrow the stage", () => {
    const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
    const rule = /\.viewer-still \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("grid-template: minmax(0, 1fr) / minmax(0, 1fr)");
    expect(rule).toContain("min-height: 0");
  });

  it("at fit, a horizontal drag pages and a drag down closes", () => {
    const { still, onIndexChange, onClose } = setup();
    drag(still, [500, 400], [300, 410]);
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    drag(still, [300, 400], [500, 390]);
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
    drag(still, [500, 300], [505, 500]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the neighbours beside the photo and moves them with the drag (#286)", () => {
    const { still } = setup();
    const stage = screen.getByTestId("desktop-viewer-stage");
    const neighbours = () => [...stage.querySelectorAll<HTMLElement>(".desktop-viewer__neighbour")];
    expect(neighbours()).toHaveLength(2);
    expect(neighbours()[0].querySelector("img")?.getAttribute("src")).toContain("/thumb/a1?size=preview");
    expect(neighbours()[1].querySelector("img")?.getAttribute("src")).toContain("/thumb/a3?size=preview");
    fireEvent.mouseDown(still, { clientX: 500, clientY: 400 });
    fireEvent.mouseMove(window, { clientX: 440, clientY: 400 });
    expect(neighbours()[1].style.transform).toBe("translateX(calc(100% + 16px + -60px))");
    expect(still.style.transform).toBe("translate(-60px, 0px) scale(1)");
    fireEvent.mouseUp(window, { clientX: 440, clientY: 400 });
  });

  it("has no neighbour past the ends and rubber-bands the drag there (#286)", () => {
    const { still } = setup(0);
    const stage = screen.getByTestId("desktop-viewer-stage");
    expect(stage.querySelectorAll(".desktop-viewer__neighbour")).toHaveLength(1);
    fireEvent.mouseDown(still, { clientX: 500, clientY: 400 });
    fireEvent.mouseMove(window, { clientX: 700, clientY: 400 });
    const x = Number(/translate\((-?[\d.]+)px/.exec(still.style.transform)![1]);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(200 * 0.6);
    fireEvent.mouseUp(window, { clientX: 700, clientY: 400 });
  });

  it("slides to the next photo before the index moves when motion is allowed (#286)", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { still, onIndexChange } = setup();
    drag(still, [500, 400], [300, 400]);
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(still.style.transform).toMatch(/^translate\(-\d+px, 0px\) scale\(1\)$/);
    expect(still.style.transition).toContain("transform");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onIndexChange).toHaveBeenCalledWith(2);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("at fit, a short drag or a drag up snaps back without paging or closing", () => {
    const { still, onIndexChange, onClose } = setup();
    drag(still, [500, 400], [460, 400]);
    drag(still, [500, 400], [500, 200]);
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(still.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("follows the drag on the window, so panning past the stage still reaches the edge in both axes", () => {
    const { still, onIndexChange } = setup(0);
    fireEvent.doubleClick(still, { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 });
    expect(still.style.transform).toContain("scale(2.5)");
    drag(still, [500, 400], [9000, 9000]);
    const [x, y] = (/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(still.style.transform) ?? []).slice(1).map(Number);
    // jsdom has no layout, so the stage is the window.
    const { innerWidth: W, innerHeight: H } = window;
    const ratio = Math.min(W / 4000, H / 3000);
    const bound = { x: Math.max(0, (4000 * ratio * 2.5 - W) / 2), y: Math.max(0, (3000 * ratio * 2.5 - H) / 2) };
    expect(bound.x).toBeGreaterThan(0);
    expect(bound.y).toBeGreaterThan(0);
    expect(x).toBeCloseTo(bound.x);
    expect(y).toBeCloseTo(bound.y);
    expect(onIndexChange).not.toHaveBeenCalled();
    drag(still, [500, 400], [-9000, -9000]);
    expect(still.style.transform).toBe(`translate(${-bound.x}px, ${-bound.y}px) scale(2.5)`);
  });
});

describe("DesktopViewer cursor (#257)", () => {
  function setup() {
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2") });
    const { container } = render(
      <DesktopViewer libraryId={1} items={[makeItem("a1", { width: 4000, height: 3000 }), makeItem("a2")]} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const still = container.querySelector(".viewer-still") as HTMLElement;
    return { still, root: screen.getByTestId("desktop-viewer") };
  }

  it("is the plain arrow at fit, never the zoom cursor", () => {
    const { still } = setup();
    expect(still.style.cursor).toBe("default");
    fireEvent.mouseDown(still, { clientX: 500, clientY: 400 });
    expect(still.style.cursor).toBe("default"); // a click or double-click does not flash the hand
    fireEvent.mouseMove(window, { clientX: 400, clientY: 400 });
    expect(still.style.cursor).toBe("grabbing"); // dragging to page
    fireEvent.mouseUp(window, { clientX: 400, clientY: 400 });
    expect(still.style.cursor).toBe("default");
  });

  it("is an open hand when zoomed and a closed hand while the button is held, everywhere in the viewer", () => {
    const { still, root } = setup();
    fireEvent.doubleClick(still, { clientX: 500, clientY: 400 });
    expect(still.style.cursor).toBe("grab");
    fireEvent.mouseDown(still, { clientX: 500, clientY: 400 });
    expect(still.style.cursor).toBe("grabbing");
    expect(root.className).toContain("is-dragging");
    fireEvent.mouseMove(window, { clientX: 450, clientY: 380 });
    expect(still.style.cursor).toBe("grabbing");
    fireEvent.mouseUp(window);
    expect(still.style.cursor).toBe("grab");
    expect(root.className).not.toContain("is-dragging");
  });

  it("keeps the closed hand over the bars while dragging", () => {
    const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
    expect(css).toMatch(/\.desktop-viewer\.is-dragging,\s*\.desktop-viewer\.is-dragging \* \{\s*cursor: grabbing;/);
    expect(readFileSync(join(__dirname, "DesktopViewer.tsx"), "utf-8")).not.toContain("zoom-in");
  });
});

describe("DesktopViewer filmstrip (F14)", () => {
  it("has no filmstrip, as in macOS Photos", () => {
    mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2") });
    render(<DesktopViewer libraryId={1} items={[makeItem("a1"), makeItem("a2")]} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    expect(screen.queryByTestId("viewer-filmstrip")).toBeNull();
  });
});

describe("DesktopViewer chrome (#211)", () => {
  it("fades the top bar 2.5 s after the last pointer move while a video plays, and shows it on move", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockDetail({ v1: makeDetail("v1", { is_video: true }) });
    render(
      <DesktopViewer libraryId={1} items={[makeItem("v1", { is_video: true })]} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );
    const bar = () => document.querySelector(".desktop-viewer__topbar") as HTMLElement;
    fireEvent.click(screen.getByLabelText("Play video"));
    fireEvent.play(screen.getByTestId("viewer-video"));
    act(() => void vi.advanceTimersByTime(2000));
    fireEvent.mouseMove(screen.getByTestId("desktop-viewer"));
    act(() => void vi.advanceTimersByTime(2000));
    expect(bar().className).not.toContain("is-chrome-hidden");
    act(() => void vi.advanceTimersByTime(500));
    expect(bar().className).toContain("is-chrome-hidden");
    fireEvent.mouseMove(screen.getByTestId("desktop-viewer"));
    expect(bar().className).not.toContain("is-chrome-hidden");
    fireEvent.pause(screen.getByTestId("viewer-video"));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(bar().className).not.toContain("is-chrome-hidden");
    vi.useRealTimers();
  });

  it("the top bar is a 52 px blurred material with the title centred in two lines", () => {
    const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
    const start = css.indexOf("\n.desktop-viewer__topbar {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("height: 52px");
    expect(rule).toContain("backdrop-filter: var(--blur-bar)");
    expect(rule).toContain("var(--material-viewer-bar)");
  });

  describe("#302 Mac Photos top bar", () => {
    const open = (items = [makeItem("a1"), makeItem("a2")], index = 0) =>
      render(<DesktopViewer libraryId={1} items={items} index={index} onIndexChange={() => {}} onClose={() => {}} />);

    it("titles with the date, then time, place and N of M", async () => {
      mockDetail({ a1: makeDetail("a1", { date_created: "2026-06-14T21:08:35" }), a2: makeDetail("a2") });
      open();
      const title = screen.getByTestId("viewer-title");
      await waitFor(() => expect(title.textContent).toContain("San Francisco"));
      expect(title.querySelector(".desktop-viewer__title-primary")?.textContent).toBe("San Francisco");
      expect(title.textContent).toMatch(/2026 at 21:08:35 · 1 of 2$/);
    });

    it("never shows a file name, stored or original, in the title", async () => {
      mockDetail({
        a1: makeDetail("a1", { place: null, place_address: null, filename: "ABC-uuid.jpg", original_filename: "IMG_1234.HEIC" }),
        a2: makeDetail("a2"),
      });
      open([makeItem("a1", { filename: "ABC-uuid.jpg" }), makeItem("a2")]);
      fireEvent.click(screen.getByLabelText("Info"));
      await screen.findByTestId("viewer-info-panel");
      const title = screen.getByTestId("viewer-title").textContent ?? "";
      expect(title).toMatch(/2024/);
      expect(title).not.toContain("ABC-uuid");
      expect(title).not.toContain("IMG_1234");
      expect(title).not.toContain("HEIC");
      expect(title).not.toContain("San Francisco");
    });

    it("has every icon button named", () => {
      mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2") });
      open();
      for (const name of ["Back", "Zoom Out", "Zoom In", "Copy Link", "Download", "Info"]) {
        expect(screen.getByRole("button", { name })).toBeInTheDocument();
      }
      expect(screen.getByRole("slider", { name: "Zoom" })).toBeInTheDocument();
      expect(screen.queryByLabelText("Close")).toBeNull();
    });

    it("the slider, + and - change the zoom", () => {
      mockDetail({ a1: makeDetail("a1"), a2: makeDetail("a2") });
      open();
      const slider = screen.getByTestId("viewer-zoom-slider") as HTMLInputElement;
      expect(slider.value).toBe("1");
      expect(screen.getByRole("button", { name: "Zoom Out" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Zoom In" }));
      expect(Number(slider.value)).toBeCloseTo(1.5);
      fireEvent.change(slider, { target: { value: "3" } });
      expect(Number(slider.value)).toBeCloseTo(3);
      fireEvent.click(screen.getByRole("button", { name: "Zoom Out" }));
      expect(Number(slider.value)).toBeCloseTo(2.5);
      fireEvent.change(slider, { target: { value: "1" } });
      expect(slider.value).toBe("1");
    });

    it("uses the viewer background token, which differs between light and dark", () => {
      const tokens = readFileSync(join(__dirname, "..", "tokens.css"), "utf-8");
      const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
      expect(tokens).toMatch(/--color-viewer-bg:\s*#fff;/);
      expect(tokens).toMatch(/--color-viewer-bg:\s*#1e1e1e;/);
      const start = css.indexOf("\n.desktop-viewer {");
      expect(css.slice(start, css.indexOf("}", start))).toContain("var(--color-viewer-bg)");
    });
  });
});
