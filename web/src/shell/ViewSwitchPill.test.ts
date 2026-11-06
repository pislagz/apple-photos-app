import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest mocks CSS imports, so assert on the stylesheet source (#117).
const css = readFileSync(join(__dirname, "shell.css"), "utf-8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.[\]"=-]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(m, `rule ${selector}`).not.toBeNull();
  return m![1];
}

describe("mobile view-switch pill (#117)", () => {
  it("keeps every label on one line", () => {
    const item = rule(".mobile-library__view-switch-item");
    expect(item).toMatch(/white-space:\s*nowrap/);
    expect(item).toMatch(/flex:\s*0 0 auto/);
  });

  it("tightens item padding on 320px phones", () => {
    expect(css).toMatch(/@media \(max-width: 359px\)\s*\{\s*\.mobile-library__view-switch-item\s*\{[^}]*padding:\s*6px 8px/);
  });

  it("reserves bottom padding so the pill never covers the last Days caption", () => {
    const scroll = rule(".mobile-library__scroll");
    const pad = Number(scroll.match(/padding-bottom:\s*(\d+)px/)?.[1]);
    expect(pad).toBeGreaterThanOrEqual(64);
  });
});
