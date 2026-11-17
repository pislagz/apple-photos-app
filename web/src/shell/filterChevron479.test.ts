import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #479: rotating the padded chevron span pivoted on its box and pushed the open
// header's glyph ~5px off the label. The rotation belongs on the svg.
describe("Filter menu chevron CSS", () => {
  const css = readFileSync("src/shell/shell.css", "utf8");
  it("rotates the glyph, not the padded span", () => {
    expect(css).toMatch(/\.filter-menu__chevron\[data-open="true"\] > svg\s*\{[^}]*rotate\(90deg\)/);
    expect(css).not.toMatch(/\.filter-menu__chevron\[data-open="true"\]\s*\{[^}]*transform/);
  });
});
