import { describe, expect, it } from "vitest";
import {
  SIDEBAR_AUTO_HIDE_WIDTH,
  effectiveSidebarCollapsed,
  isNarrow,
  isSidebarShortcut,
  sidebarOpen,
} from "./sidebarAuto";

describe("sidebar auto-hide (#368)", () => {
  it("is narrow strictly below the threshold", () => {
    expect(isNarrow(SIDEBAR_AUTO_HIDE_WIDTH - 1)).toBe(true);
    expect(isNarrow(SIDEBAR_AUTO_HIDE_WIDTH)).toBe(false);
  });
  it("hides when narrow whatever the user chose, and restores the choice", () => {
    expect(effectiveSidebarCollapsed(false, true)).toBe(true);
    expect(effectiveSidebarCollapsed(false, false)).toBe(false);
    expect(effectiveSidebarCollapsed(true, false)).toBe(true);
    expect(effectiveSidebarCollapsed(true, true)).toBe(true);
  });
  it("narrow: open state is the overlay's, not the user's choice (#392)", () => {
    expect(sidebarOpen(true, true, true)).toBe(true);
    expect(sidebarOpen(false, true, false)).toBe(false);
    expect(sidebarOpen(false, false, true)).toBe(true);
    expect(sidebarOpen(true, false, true)).toBe(false);
  });
  it("recognises Cmd/Ctrl+Option+S", () => {
    expect(isSidebarShortcut({ key: "s", code: "KeyS", metaKey: true, ctrlKey: false, altKey: true })).toBe(true);
    expect(isSidebarShortcut({ key: "s", metaKey: false, ctrlKey: true, altKey: true })).toBe(true);
    expect(isSidebarShortcut({ key: "s", code: "KeyS", metaKey: false, ctrlKey: false, altKey: true })).toBe(false);
    expect(isSidebarShortcut({ key: "s", code: "KeyS", metaKey: true, ctrlKey: false, altKey: false })).toBe(false);
  });
  it("matches on the physical key: Mac Option+S reports key 'ß' (#392)", () => {
    expect(isSidebarShortcut({ key: "ß", code: "KeyS", metaKey: true, ctrlKey: false, altKey: true })).toBe(true);
    expect(isSidebarShortcut({ key: "ß", code: "KeyX", metaKey: true, ctrlKey: false, altKey: true })).toBe(false);
  });
});
