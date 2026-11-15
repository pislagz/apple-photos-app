import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// #372: the desktop viewer bar follows the Mac Photos toolbar.
const css = readFileSync(resolve(process.cwd(), "src/shell/shell.css"), "utf8");
const tokens = readFileSync(resolve(process.cwd(), "src/shell/tokens.css"), "utf8");

describe("desktop viewer top bar styling (#372)", () => {
  it("shares the grid toolbar's hairline and colours for both appearances (#434)", () => {
    expect(css).toMatch(/\.desktop-viewer__topbar \{[^}]*border-bottom: 1px solid var\(--color-toolbar-separator\)/s);
    expect(tokens.match(/--color-toolbar-separator:/g)).toHaveLength(2);
  });

  it("never hides the sidebar toggle in the viewer, and lets the wide viewer start after the sidebar (#444)", () => {
    expect(css).not.toMatch(/has\(\.desktop-viewer\) \.sidebar-toggle \{\s*display: none/);
    expect(css).toMatch(
      /\.shell--desktop:not\(\.shell--sidebar-narrow\):not\(\.shell--sidebar-collapsed\) \.desktop-viewer \{\s*left: var\(--sidebar-width/,
    );
  });

  it("uses regular-weight toolbar titles in grid and viewer (#445)", () => {
    expect(css).toMatch(/\.desktop-viewer__title-primary \{[^}]*font-weight: var\(--font-weight-regular\)/s);
    expect(css).toMatch(/\.desktop-library__title \{[^}]*font-weight: var\(--font-weight-regular\)/s);
    expect(css).toMatch(/\.shell--desktop \.toolbar h1 \{[^}]*font-weight: var\(--font-weight-regular\)/s);
    expect(css).toMatch(/\.desktop-viewer__title-secondary \{[^}]*font-weight: 400/s);
  });

  it("never uses a pointer cursor", () => {
    expect(css).not.toMatch(/cursor:\s*pointer/);
  });
});
