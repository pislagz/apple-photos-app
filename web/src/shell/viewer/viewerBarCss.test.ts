import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// #372: the desktop viewer bar follows the Mac Photos toolbar.
const css = readFileSync(resolve(process.cwd(), "src/shell/shell.css"), "utf8");
const tokens = readFileSync(resolve(process.cwd(), "src/shell/tokens.css"), "utf8");

describe("desktop viewer top bar styling (#372)", () => {
  it("has a hairline under the bar and a line colour for both appearances", () => {
    expect(css).toMatch(/\.desktop-viewer__topbar \{[^}]*border-bottom: 0\.5px solid var\(--color-viewer-bar-line\)/s);
    expect(tokens.match(/--color-viewer-bar-line:/g)).toHaveLength(2);
  });

  it("uses a bold date over a regular secondary line", () => {
    expect(css).toMatch(/\.desktop-viewer__title-primary \{[^}]*font-weight: var\(--font-weight-bold/s);
    expect(css).toMatch(/\.desktop-viewer__title-secondary \{[^}]*font-weight: 400/s);
  });

  it("never uses a pointer cursor", () => {
    expect(css).not.toMatch(/cursor:\s*pointer/);
  });
});
