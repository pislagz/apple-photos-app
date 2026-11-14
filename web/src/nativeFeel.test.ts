import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

// #236: web giveaways stay removed.
describe("native feel", () => {
  const css = read("shell/shell.css");
  it("no tap highlight, no rubber-band shell", () => {
    expect(css).toMatch(/html\s*\{[^}]*overscroll-behavior: none[^}]*-webkit-tap-highlight-color: transparent/s);
  });
  it("chrome is unselectable, tiles have no callout or drag", () => {
    expect(css).toMatch(/\.tab-bar,[\s\S]*?user-select: none/);
    expect(css).toMatch(/-webkit-touch-callout: none;\s*-webkit-user-drag: none/);
    expect(css).not.toMatch(/(^|\n)(p|\.caption|input|textarea)[^{]*\{[^}]*user-select: none/);
  });
  it("letter-spacing comes from tokens", () => {
    expect(css.match(/letter-spacing: -?\d/g)).toBeNull();
  });
  it("ui-rounded only lives in tokens.css", () => {
    expect(css).not.toMatch(/ui-rounded/);
    expect(read("shell/tokens.css")).toMatch(/--font-rounded: ui-rounded/);
  });
  it("home-screen meta is in place", () => {
    const html = readFileSync(join(__dirname, "../index.html"), "utf8");
    expect(html).toMatch(/viewport-fit=cover/);
    expect(html).toMatch(/rel="apple-touch-icon"/);
    expect(html).toMatch(/apple-mobile-web-app-status-bar-style/);
    expect(html).toMatch(/background: Canvas/);
  });
});
