import { describe, expect, it } from "vitest";
import { viewerKeyAction } from "./viewerKeys";

function ev(key: string, target: EventTarget | null, extra: Record<string, boolean> = {}) {
  return { key, target, defaultPrevented: false, metaKey: false, ctrlKey: false, altKey: false, ...extra };
}

describe("viewerKeyAction", () => {
  it("navigates with arrows from body", () => {
    expect(viewerKeyAction(ev("ArrowLeft", document.body), null)).toBe("prev");
    expect(viewerKeyAction(ev("ArrowRight", document.body), null)).toBe("next");
  });

  it("ignores arrows from video, audio, and inputs", () => {
    for (const tag of ["video", "audio", "input", "textarea", "select"]) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      expect(viewerKeyAction(ev("ArrowRight", el), null)).toBeNull();
      el.remove();
    }
  });

  it("ignores arrows from inside a video and from contenteditable", () => {
    const video = document.createElement("video");
    const child = document.createElement("span");
    video.appendChild(child);
    expect(viewerKeyAction(ev("ArrowLeft", child), null)).toBeNull();
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    expect(viewerKeyAction(ev("ArrowLeft", div), null)).toBeNull();
  });

  it("closes on Esc normally", () => {
    expect(viewerKeyAction(ev("Escape", document.body), null)).toBe("close");
  });

  it("does not close on Esc while fullscreen", () => {
    expect(viewerKeyAction(ev("Escape", document.body), document.createElement("video"))).toBeNull();
  });

  it("ignores Esc from text inputs", () => {
    expect(viewerKeyAction(ev("Escape", document.createElement("input")), null)).toBeNull();
  });

  it("ignores defaultPrevented and modified keys", () => {
    expect(viewerKeyAction(ev("Escape", document.body, { defaultPrevented: true }), null)).toBeNull();
    expect(viewerKeyAction(ev("ArrowLeft", document.body, { metaKey: true }), null)).toBeNull();
    expect(viewerKeyAction(ev("ArrowLeft", document.body, { altKey: true }), null)).toBeNull();
  });
});
