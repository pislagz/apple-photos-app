import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom does no layout, so the #219 card dimensions are pinned in the source.
const css = readFileSync(resolve(process.cwd(), "src/shell/shell.css"), "utf8");

describe("iPhone period card dimensions (#219)", () => {
  it("Days 230px / 24px, Years 300px / 28px, month header 24px", () => {
    expect(css).toMatch(/\.period-card--phone \{[^}]*height: 230px;[^}]*border-radius: 24px/);
    expect(css).toMatch(/\.period-grid--years \.period-card--phone \{[^}]*height: 300px;[^}]*border-radius: 28px/);
    expect(css).toMatch(/\.period-grid__month \{[^}]*font-size: 24px/);
    expect(css).toMatch(/\.period-card__mosaic \{[^}]*width: 118px/);
  });
});
