import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// #351: the Filter button reuses the Select glass pill, and the phone grid
// can never pan sideways.
const css = readFileSync(join(__dirname, "shell.css"), "utf8");
const rule = (selector: string) => {
  const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]]/g, "\\$&")} \\{([^}]*)\\}`));
  return match?.[1] ?? "";
};

describe("iPhone header CSS", () => {
  it("gives the shared glass button a blur and a tint", () => {
    const glass = rule(".mobile-library__glass-button");
    expect(glass).toMatch(/backdrop-filter: var\(--blur-/);
    expect(glass).toMatch(/background: var\(--glass-button\)/);
  });

  it("opens the menu from a button that has the glass class", () => {
    const source = readFileSync(join(__dirname, "library", "FilterMenu.tsx"), "utf8");
    expect(source).toContain("filter-menu__button mobile-library__glass-button");
  });

  it("insets the top bar by 16px or the safe area, with no account-button gutter", () => {
    const bar = rule(".mobile-library__top-bar");
    expect(bar).toContain("max(var(--space-16), env(safe-area-inset-right, 0px))");
    expect(bar).not.toContain("74px");
  });

  it("clips the grid scroller horizontally", () => {
    expect(rule(".mobile-library__scroll")).toContain("overflow-x: hidden");
  });
});
