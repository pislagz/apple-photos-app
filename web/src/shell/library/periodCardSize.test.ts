import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom does no layout, so the card size is pinned in the stylesheet source:
// outside the phone media query, Months must not override Years' minimum.
const css = readFileSync(resolve(process.cwd(), "src/shell/shell.css"), "utf8");
const desktopCss = css.replace(/@media \(max-width: 600px\) \{(?:[^{}]|\{[^{}]*\})*\}/g, "");

describe("period card size (#323)", () => {
  it("has no desktop override that makes Months cards smaller than Years", () => {
    expect(desktopCss).toMatch(/\.period-grid \{[^}]*--period-card-min: 168px/);
    expect(desktopCss).not.toMatch(/\.period-grid--(months|years)\s*\{[^}]*--period-card-min/);
  });
});
