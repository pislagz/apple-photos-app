import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

// #232: measured values live in tokens.css; components use var().
describe("design tokens", () => {
  const tokens = read("shell/tokens.css");
  const css = read("shell/shell.css");

  it("defines the blur, radius and metric tokens once", () => {
    for (const name of ["--blur-material", "--blur-bar", "--radius-24", "--size-sidebar-row", "--size-toolbar"]) {
      expect(tokens.match(new RegExp(`^\\s*${name}:`, "gm"))).toHaveLength(1);
    }
  });

  it("measured hover and selected fills", () => {
    expect(tokens).toContain("--color-hover: rgba(0, 0, 0, 0.04)");
    expect(tokens).toContain("--color-sidebar-selected: rgba(255, 255, 255, 0.16)");
  });

  it("shell.css has no literal backdrop blur or radius px outside tokens", () => {
    expect(css).not.toMatch(/backdrop-filter:\s*blur\(/);
    expect(css).not.toMatch(/^\s+border-radius:\s*\d+(\.\d+)?px;/m);
    expect(css).not.toMatch(/^\s+font-size:\s*\d+px;/m);
  });

  it("no token is declared twice in :root", () => {
    const root = tokens.split("@media (prefers-color-scheme: dark)")[0];
    const names = [...root.matchAll(/^\s+(--[a-z0-9-]+):/gm)].map((m) => m[1]);
    expect(names.length).toBe(new Set(names).size);
  });
});
