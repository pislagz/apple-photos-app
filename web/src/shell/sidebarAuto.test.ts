import { describe, expect, it } from "vitest";
import {
  SIDEBAR_AUTO_HIDE_WIDTH,
  effectiveSidebarCollapsed,
  isNarrow,
  isSidebarShortcut,
  toggleUserCollapsed,
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
  it("ignores the toggle while narrow", () => {
    expect(toggleUserCollapsed(false, true)).toBe(false);
    expect(toggleUserCollapsed(true, true)).toBe(true);
    expect(toggleUserCollapsed(false, false)).toBe(true);
    expect(toggleUserCollapsed(true, false)).toBe(false);
  });
  it("recognises Cmd/Ctrl+Option+S", () => {
    expect(isSidebarShortcut({ key: "s", metaKey: true, ctrlKey: false, altKey: true })).toBe(true);
    expect(isSidebarShortcut({ key: "s", metaKey: false, ctrlKey: false, altKey: true })).toBe(false);
  });
});
