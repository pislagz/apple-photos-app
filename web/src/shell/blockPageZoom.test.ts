import { afterEach, describe, expect, it } from "vitest";
import { installBlockPageZoom } from "./blockPageZoom";

describe("installBlockPageZoom (#409)", () => {
  let remove = () => {};
  afterEach(() => remove());

  it("cancels ctrl+wheel anywhere but leaves plain scrolling alone", () => {
    remove = installBlockPageZoom();
    const pinch = new WheelEvent("wheel", { ctrlKey: true, deltaY: -5, cancelable: true, bubbles: true });
    document.body.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);
    const scroll = new WheelEvent("wheel", { deltaY: 40, cancelable: true, bubbles: true });
    document.body.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
  });

  it("cancels Safari gesture events and does not stop propagation", () => {
    remove = installBlockPageZoom();
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
      const event = new Event(type, { cancelable: true, bubbles: true });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    let seen = false;
    const listener = () => {
      seen = true;
    };
    document.body.addEventListener("wheel", listener);
    document.body.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, cancelable: true, bubbles: true }));
    document.body.removeEventListener("wheel", listener);
    expect(seen).toBe(true);
  });
});
