import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetListItem } from "../../api";
import { useFakeLayout } from "../../testLayout";
import { Filmstrip } from "./Filmstrip";
import { PITCH } from "./filmstripGeometry";

useFakeLayout({ width: 400 });

const make = (n: number, over: (i: number) => Partial<AssetListItem> = () => ({})): AssetListItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    filename: `a${i}.jpg`,
    date: "2024-05-10T10:00:00",
    is_video: false,
    is_live_photo: false,
    favorite: false,
    width: 100,
    height: 100,
    duration: null,
    ...over(i),
  }));
const items = make(50000);

const translateX = (el: HTMLElement) => Number(/translateX\((-?[\d.]+)px\)/.exec(el.style.transform)![1]);
const buttons = () => screen.getAllByRole("button");
const strip = () => screen.getByTestId("viewer-filmstrip");

beforeEach(() => {
  // Run animation frames synchronously so a drag is observable in one step.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0; // already ran, so no pending handle
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
});
afterEach(() => vi.unstubAllGlobals());

function drag(dxs: number[]) {
  const el = strip();
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 200 });
  let x = 200;
  for (const dx of dxs) {
    x += dx;
    fireEvent.pointerMove(el, { pointerId: 1, clientX: x });
  }
  return { el, up: () => fireEvent.pointerUp(el, { pointerId: 1, clientX: x }) };
}

describe("Filmstrip scrubber (#221)", () => {
  it("is 44 px tall and mounts only a bounded window of 50k items", () => {
    render(<Filmstrip libraryId={1} items={items} index={25000} onSelect={() => {}} className="strip" />);
    expect(strip().style.height).toBe("44px");
    expect(buttons().length).toBe(81);
    expect(buttons().length).toBeLessThan(100);
  });

  it("keeps the current item mounted far beyond the old +-25 window, centred and wider", () => {
    render(<Filmstrip libraryId={1} items={items} index={3000} onSelect={() => {}} className="strip" />);
    const current = buttons().find((b) => b.getAttribute("aria-current") === "true")!;
    expect(current.querySelector("img")?.getAttribute("src")).toContain("/thumb/a3000?");
    expect(current.style.width).toBe("44px");
    expect(translateX(current)).toBe(-22);
    const next = buttons().find((b) => b.dataset.index === "3001")!;
    expect(next.style.width).toBe("34px");
    expect(translateX(next)).toBe(27);
  });

  it("windows around the current item when it changes", () => {
    const { rerender } = render(<Filmstrip libraryId={1} items={items} index={10} onSelect={() => {}} className="strip" />);
    rerender(<Filmstrip libraryId={1} items={items} index={40000} onSelect={() => {}} className="strip" />);
    expect(buttons().some((b) => b.dataset.index === "40000")).toBe(true);
    expect(buttons().some((b) => b.dataset.index === "10")).toBe(false);
  });

  it("tapping a slit makes it current", () => {
    const onSelect = vi.fn();
    render(<Filmstrip libraryId={1} items={items} index={100} onSelect={onSelect} className="strip" />);
    const target = buttons().find((b) => b.dataset.index === "104")!;
    fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientX: 300 });
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 300 });
    fireEvent.click(target);
    expect(onSelect).toHaveBeenCalledWith(104);
  });

  it("dragging changes the photo live as items pass the centre, then settles", () => {
    const onSelect = vi.fn();
    const scrubbing = vi.fn();
    render(<Filmstrip libraryId={1} items={items} index={100} onSelect={onSelect} onScrubbingChange={scrubbing} className="strip" />);
    // Drag left by 3 pitches: later photos come to the centre.
    const { up } = drag([-10, -PITCH * 3 + 10]);
    expect(onSelect).toHaveBeenLastCalledWith(103);
    expect(strip().dataset.dragging).toBe("true");
    expect(scrubbing).toHaveBeenCalledWith(true);
    up();
    expect(strip().dataset.dragging).toBe("false");
    expect(scrubbing).toHaveBeenLastCalledWith(false);
  });

  it("reaches deep into a large library with one long drag and clamps at the ends", () => {
    const onSelect = vi.fn();
    render(<Filmstrip libraryId={1} items={items} index={5} onSelect={onSelect} className="strip" />);
    drag([PITCH * 100]); // rightwards past the start
    expect(onSelect).toHaveBeenLastCalledWith(0);
    const far = vi.fn();
    render(<Filmstrip libraryId={1} items={items} index={49990} onSelect={far} className="strip" />);
    const strips = screen.getAllByTestId("viewer-filmstrip");
    const el = strips[1];
    fireEvent.pointerDown(el, { pointerId: 2, button: 0, clientX: 200 });
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 200 - PITCH * 500 });
    expect(far).toHaveBeenLastCalledWith(49999);
  });

  it("a drag does not also count as a tap", () => {
    const onSelect = vi.fn();
    render(<Filmstrip libraryId={1} items={items} index={100} onSelect={onSelect} className="strip" />);
    const { up } = drag([-PITCH * 2]);
    up();
    onSelect.mockClear();
    fireEvent.click(buttons()[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("the wheel steps through photos", () => {
    const onSelect = vi.fn();
    render(<Filmstrip libraryId={1} items={items} index={100} onSelect={onSelect} className="strip" />);
    fireEvent.wheel(strip(), { deltaY: PITCH * 2 });
    expect(onSelect).toHaveBeenCalledWith(102);
  });

  it("gives a video a wide frames cell with a playhead, and scrubs inside it", () => {
    const vids = make(20, (i) => (i === 5 ? { is_video: true, duration: 10, width: 1920, height: 1080 } : {}));
    const onVideoScrub = vi.fn();
    const onSelect = vi.fn();
    render(<Filmstrip libraryId={1} items={vids} index={5} onSelect={onSelect} onVideoScrub={onVideoScrub} className="strip" />);
    const cell = buttons().find((b) => b.dataset.index === "5")!;
    expect(cell.style.width).toBe("150px");
    expect(cell.querySelector(".strip__frames")).not.toBeNull();
    expect(screen.getByTestId("filmstrip-playhead")).toBeTruthy();
    // Cell spans x 125..275 of the 400 px strip.
    const el = strip();
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 200 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 230 });
    expect(onVideoScrub).toHaveBeenLastCalledWith(0.7);
    expect(onSelect).not.toHaveBeenCalled();
    // Past the edge the drag continues into the photo list.
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 275 + PITCH * 2 });
    expect(onSelect).toHaveBeenLastCalledWith(3);
    expect(screen.queryByTestId("filmstrip-playhead")).toBeNull();
  });

  it("keeps every thumb a labelled, focusable button", () => {
    render(<Filmstrip libraryId={1} items={items} index={0} onSelect={() => {}} className="strip" />);
    for (const b of buttons().slice(0, 5)) {
      expect(b.getAttribute("aria-label")).toBeTruthy();
      expect(b.tabIndex).not.toBe(-1);
    }
    expect(buttons()[0].getAttribute("aria-current")).toBe("true");
  });
});
