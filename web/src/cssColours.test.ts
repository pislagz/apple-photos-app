import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script with no type declarations
import { scan } from "../../scripts/check_css_colours.mjs";

// #218: colour literals belong in tokens.css only.
describe("css colour check", () => {
  it("flags hex, rgb() and prefers-color-scheme", () => {
    const problems = scan(".a { color: #fff; background: rgba(0, 0, 0, .5); }\n@media (prefers-color-scheme: dark) {}");
    expect(problems.map((p: { what: string }) => p.what)).toEqual([
      "hex colour",
      "rgb/hsl colour",
      "prefers-color-scheme block",
    ]);
  });

  it("ignores comments, var() and issue numbers in comments", () => {
    expect(scan("/* #218 and #fff */ .a { color: var(--color-label); }")).toEqual([]);
  });

  it("honours an allow comment on the line above or inline", () => {
    expect(scan("/* colour-allow: data URI */\n.a { background: url(\"data:image/svg+xml,%3Csvg fill='#fff'/%3E\"); }")).toEqual([]);
    expect(scan(".a { color: #fff; /* colour-allow: demo */ }")).toEqual([]);
    expect(scan(".a { color: #fff; }")).toHaveLength(1);
  });

  it("the shipped stylesheets are clean, and only tokens.css has literals", () => {
    const run = () => execFileSync("node", [join(__dirname, "../../scripts/check_css_colours.mjs"), __dirname]);
    expect(() => run()).not.toThrow();
    expect(readFileSync(join(__dirname, "shell/tokens.css"), "utf8")).toContain("#0a84ff");
  });
});
