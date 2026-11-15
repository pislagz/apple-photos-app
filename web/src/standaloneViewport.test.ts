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
    expect(rule(":root")).toMatch(/--safe-bottom:\s*env\(safe-area-inset-bottom/);
    expect(rule(".tab-bar")).toMatch(/var\(--safe-bottom\)/);
    expect(rule(".mobile-screen__header")).toMatch(/env\(safe-area-inset-top/);
  });
});

// #407: no black strip under the tab bar.
describe("tab bar reaches the physical bottom (#407)", () => {
  it("fills the root chain on iOS and keeps the tab bar background translucent material, not transparent", () => {
    expect(css).toMatch(/-webkit-touch-callout: none\)\s*\{[^}]*height:\s*-webkit-fill-available/);
    expect(rule(".tab-bar")).toMatch(/background:\s*var\(--material-bar\)/);
    expect(html).toMatch(/theme-color/);
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

// #414 / #415: one top offset for every phone Library view.
describe("phone Library top inset (#414, #415)", () => {
  it("defines one --safe-top and one --library-top-inset token", () => {
    expect(rule(":root")).toMatch(/--safe-top:\s*env\(safe-area-inset-top/);
    expect(rule(":root")).toMatch(/--library-top-inset:\s*calc\(var\(--safe-top\)/);
  });

  it("pads the scroller by that inset and leaves no per-view top padding", () => {
    expect(rule(".mobile-library__scroll")).toMatch(/padding-top:\s*var\(--library-top-inset\)/);
    expect(rule(".period-grid--phone")).toMatch(/padding:\s*0 var\(--space-16\)/);
    expect(rule(".period-grid--phone .period-grid__header")).toMatch(/padding:\s*0 /);
  });

  it("does not reserve the title block where the view has no top-bar title (#431)", () => {
    // #446: Years, Months and Days each carry their own title, one shared inset.
    expect(css).toMatch(
      /data-view="days"\][^{]*data-view="months"\][^{]*data-view="years"\][^{]*\{[^}]*padding-top:\s*calc\(var\(--safe-top\) \+ var\(--space-8\)\);/,
    );
  });
});
