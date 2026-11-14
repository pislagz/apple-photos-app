import { describe, expect, it } from "vitest";
import { clampSidebarWidth, readSidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_WIDTH_KEY } from "./sidebarWidth";
import { isControlTarget, isTypingTarget, shortcutAction } from "./shortcuts";

const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  ...extra,
});

describe("shortcutAction", () => {
  it("maps the Cmd shortcuts", () => {
    expect(shortcutAction(key("="))).toBe("zoomIn");
    expect(shortcutAction(key("+"))).toBe("zoomIn");
    expect(shortcutAction(key("-"))).toBe("zoomOut");
    expect(shortcutAction(key("["))).toBe("back");
    expect(shortcutAction(key("i"))).toBe("info");
    expect(shortcutAction(key("ArrowUp"))).toBe("up");
    expect(shortcutAction(key("a"))).toBe("selectAll");
    expect(shortcutAction(key("a", { metaKey: false, ctrlKey: true }))).toBe("selectAll");
  });
  it("ignores plain keys and Alt combos", () => {
    expect(shortcutAction(key("a", { metaKey: false }))).toBeNull();
    expect(shortcutAction(key("a", { altKey: true }))).toBeNull();
  });
});

describe("targets", () => {
  it("detects text fields and controls", () => {
    const input = document.createElement("input");
    const button = document.createElement("button");
    const div = document.createElement("div");
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(button)).toBe(false);
    expect(isControlTarget(button)).toBe(true);
    expect(isControlTarget(div)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("sidebar width", () => {
  it("clamps to 190-300", () => {
    expect(clampSidebarWidth(100)).toBe(190);
    expect(clampSidebarWidth(500)).toBe(300);
    expect(clampSidebarWidth(250.4)).toBe(250);
    expect(clampSidebarWidth(NaN)).toBe(SIDEBAR_DEFAULT);
  });
  it("reads a stored width, clamped, defaulting to 220", () => {
    localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    expect(readSidebarWidth()).toBe(220);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "999");
    expect(readSidebarWidth()).toBe(300);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "junk");
    expect(readSidebarWidth()).toBe(220);
    localStorage.removeItem(SIDEBAR_WIDTH_KEY);
  });
});

describe("select-all guard (#366)", () => {
  const ev = (target: EventTarget | null, extra: Partial<KeyboardEvent> = {}) => ({ ...key("a"), target, ...extra });

  it("blocks the browser's Select All outside fields", async () => {
    const { blocksBrowserSelectAll } = await import("./shortcuts");
    expect(blocksBrowserSelectAll(ev(document.body))).toBe(true);
    expect(blocksBrowserSelectAll(ev(document.body, { metaKey: false, ctrlKey: true }))).toBe(true);
    expect(blocksBrowserSelectAll({ ...key("b"), target: document.body })).toBe(false);
  });

  it("leaves fields and the Info panel text alone", async () => {
    const { blocksBrowserSelectAll } = await import("./shortcuts");
    expect(blocksBrowserSelectAll(ev(document.createElement("input")))).toBe(false);
    expect(blocksBrowserSelectAll(ev(document.createElement("textarea")))).toBe(false);
    const dl = document.createElement("dl");
    dl.setAttribute("data-selectable-text", "");
    const dd = document.createElement("dd");
    dl.append(dd);
    expect(blocksBrowserSelectAll(ev(dd))).toBe(false);
  });

  it("installs a capture listener that cancels the default", async () => {
    const { installSelectAllGuard } = await import("./shortcuts");
    const off = installSelectAllGuard();
    const event = new KeyboardEvent("keydown", { key: "a", metaKey: true, cancelable: true, bubbles: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    off();
  });
});
