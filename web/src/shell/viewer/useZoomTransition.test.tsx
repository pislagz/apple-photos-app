import { act, render } from "@testing-library/react";
import { type RefObject, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDismiss } from "./useDismiss";
import { useZoomTransition } from "./useZoomTransition";

const items = [
  { id: "a", width: 400, height: 300 },
  { id: "b", width: 300, height: 400 },
];

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

let zoom: ReturnType<typeof useZoomTransition>["zoomOut"];
let dismiss: (from?: never) => void;
let onClose: ReturnType<typeof vi.fn>;

function Harness({ id }: { id: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const item = items.find((i) => i.id === id);
  const { zoomOut } = useZoomTransition({ rootRef, stageRef, item });
  zoom = zoomOut;
  dismiss = useDismiss(onClose as () => void, zoomOut).dismiss as never;
  return (
    <div ref={rootRef} data-testid="root">
      <div className="mobile-viewer__topbar" />
      <div ref={stageRef as RefObject<HTMLDivElement>} data-testid="stage" />
    </div>
  );
}

function addTile(id: string, box: DOMRect) {
  const tile = document.createElement("div");
  tile.dataset.assetId = id;
  tile.getBoundingClientRect = () => box;
  document.body.append(tile);
  return tile;
}

let calls: { el: Element; keyframes: unknown; options: KeyframeAnimationOptions }[];
let finish: () => void;

beforeEach(() => {
  calls = [];
  onClose = vi.fn();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false && query.includes("reduce") }));
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 800);
  const pending: (() => void)[] = [];
  finish = () => pending.forEach((resolve) => resolve());
  Element.prototype.animate = function (this: Element, keyframes: unknown, options: unknown) {
    calls.push({ el: this, keyframes, options: options as KeyframeAnimationOptions });
    return {
      finished: new Promise<void>((resolve) => pending.push(resolve)),
      cancel: vi.fn(),
    } as unknown as Animation;
  } as typeof Element.prototype.animate;
  // jsdom has no layout: give the stage a rectangle.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === "stage" ? rect(0, 0, 390, 700) : rect(0, 0, 0, 0);
  });
});

afterEach(() => {
  document.querySelectorAll("[data-asset-id]").forEach((el) => el.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // @ts-expect-error cleanup of the test's own stub
  delete Element.prototype.animate;
});

function stageAnimation() {
  return calls.find((c) => (c.el as HTMLElement).dataset.testid === "stage");
}

describe("open", () => {
  it("zooms the stage from the tapped tile to rest and hides the tile meanwhile", () => {
    const tile = addTile("a", rect(20, 40, 100, 100));
    const { getByTestId } = render(<Harness id="a" />);
    const call = stageAnimation();
    expect(call).toBeDefined();
    const [from, to] = call!.keyframes as { transform: string; clipPath: string }[];
    expect(from.transform).toMatch(/^translate\(-125px, -260px\) scale\(0\.3/);
    expect(to.transform).toBe("translate(0px, 0px) scale(1)");
    expect(to.clipPath).toBe("inset(0px 0px 0px 0px)");
    expect(getByTestId("root").dataset.zoom).toBe("1");
    expect(tile.style.visibility).toBe("hidden");
    // The chrome fades with it.
    expect(calls.some((c) => (c.el as HTMLElement).className === "mobile-viewer__topbar")).toBe(true);
    act(() => finish());
  });

  it("falls back to the CSS fade when the tile is not rendered", () => {
    const { getByTestId } = render(<Harness id="a" />);
    expect(calls).toHaveLength(0);
    expect(getByTestId("root").dataset.zoom).toBeUndefined();
  });

  it("falls back when the tile is outside the window", () => {
    addTile("a", rect(0, 2000, 100, 100));
    const { getByTestId } = render(<Harness id="a" />);
    expect(calls).toHaveLength(0);
    expect(getByTestId("root").dataset.zoom).toBeUndefined();
  });

  it("does nothing with reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    addTile("a", rect(20, 40, 100, 100));
    const { getByTestId } = render(<Harness id="a" />);
    expect(calls).toHaveLength(0);
    expect(getByTestId("root").dataset.zoom).toBeUndefined();
  });
});

describe("close", () => {
  it("zooms back into the tile of the item shown now, not the one opened from", async () => {
    addTile("a", rect(20, 40, 100, 100));
    addTile("b", rect(250, 500, 120, 120));
    const { rerender } = render(<Harness id="a" />);
    act(() => finish());
    calls.length = 0;
    rerender(<Harness id="b" />);
    act(() => dismiss());
    const call = stageAnimation()!;
    const [from, to] = call.keyframes as { transform: string }[];
    expect(from.transform).toBe("translate(0px, 0px) scale(1)");
    // Tile b's centre (310, 560) against the stage centre (195, 350).
    expect(to.transform).toMatch(/^translate\(115px, 210px\) scale\(0\.307/);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts from a swipe-down's last frame", () => {
    addTile("a", rect(20, 40, 100, 100));
    render(<Harness id="a" />);
    act(() => finish());
    calls.length = 0;
    act(() => (dismiss as (from: unknown) => void)({ dx: 10, dy: 150, scale: 0.9, clip: { top: 0, right: 0, bottom: 0, left: 0 } }));
    const [from] = stageAnimation()!.keyframes as { transform: string }[];
    expect(from.transform).toBe("translate(10px, 150px) scale(0.9)");
  });

  it("returns null without a tile so useDismiss plays its fade", () => {
    vi.useFakeTimers();
    render(<Harness id="a" />);
    expect(zoom()).toBeNull();
    act(() => dismiss());
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("closes at once with reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    addTile("a", rect(20, 40, 100, 100));
    render(<Harness id="a" />);
    act(() => dismiss());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });
});
