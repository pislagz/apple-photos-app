import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "shell/shell.css"), "utf8");
const html = readFileSync(join(__dirname, "../index.html"), "utf8");

// Every standalone `selector { ... }` block, joined (a selector may be split over several rules).
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blocks = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]);
  expect(blocks.length, selector).toBeGreaterThan(0);
  return blocks.join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
}

// #387: iPhone home-screen mode.
describe("standalone viewport", () => {
  it("covers the notch and home indicator area", () => {
    expect(html).toMatch(/name="viewport"[^>]*viewport-fit=cover/);
    expect(html).toMatch(/apple-mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  });

  it("pins the mobile shell to the viewport edges, not 100dvh", () => {
    const shell = rule(".shell--mobile");
    expect(shell).toMatch(/position:\s*fixed/);
    expect(shell).toMatch(/inset:\s*0/);
    expect(shell).not.toMatch(/100d?vh/);
  });

  it("paints the app background down the whole root chain", () => {
    expect(css).toMatch(/html,\s*body,\s*#root\s*\{\s*height:\s*100%/);
    expect(rule("html")).toMatch(/background:\s*var\(--color-bg\)/);
  });

  it("keeps the home-indicator inset on the tab bar and the notch inset on headers", () => {
    expect(rule(".tab-bar")).toMatch(/env\(safe-area-inset-bottom/);
    expect(rule(".mobile-screen__header")).toMatch(/env\(safe-area-inset-top/);
  });
});

// #389: the More list.
describe("More list", () => {
  it("rows meet the 44pt hit target and the list adds no second bottom inset", () => {
    expect(rule(".more-screen__item")).toMatch(/min-height:\s*(4[4-9]|[5-9]\d)px/);
    expect(rule(".more-screen__library-switcher")).not.toMatch(/safe-area/);
  });
});

// #388: empty states are centred in the free area.
describe("empty states", () => {
  it("centres the phone library empty state between header and view switch", () => {
    expect(css).toMatch(/\.mobile-library__scroll:has\(\.library-empty[^{]*\{[^}]*flex-direction:\s*column/);
    expect(rule(".mobile-screen__body--empty")).toMatch(/justify-content:\s*center/);
  });
});
