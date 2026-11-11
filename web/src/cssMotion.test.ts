import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script with no type declarations
import { scan } from "../../scripts/check_css_motion.mjs";

// #206: durations belong in tokens.css only.
describe("css motion check", () => {
  it("flags literal durations in transition and animation declarations", () => {
    const css = ".a { transition: opacity 0.2s ease; }\n.b { animation: x 150ms linear; }\n.c { transition-duration: 1s; }";
    expect(scan(css).map((p: { text: string }) => p.text)).toEqual(["0.2s", "150ms", "1s"]);
  });

  it("flags a duration on a later line of a multi-line transition", () => {
    const css = ".a {\n  transition:\n    opacity var(--dur-tint) ease,\n    transform 0.3s ease;\n}";
    expect(scan(css)).toEqual([{ line: 4, text: "0.3s" }]);
  });

  it("accepts tokens, keyframe names and comments", () => {
    expect(scan(".a { transition: opacity var(--dur-tint) var(--ease-tint); animation: menu-in var(--dur-menu) ease; }")).toEqual([]);
    expect(scan("/* was transition: opacity 0.1s */ .a { animation-delay: var(--d); }")).toEqual([]);
    expect(scan(".a { animation: slide-in-2s var(--dur-slide); }")).toEqual([]);
  });

  it("honours an allow comment on the line above or inline", () => {
    expect(scan("/* motion-allow: spinner */\n.a { animation: spin 1s linear infinite; }")).toEqual([]);
    expect(scan(".a { animation: spin 1s linear; /* motion-allow: demo */ }")).toEqual([]);
    expect(scan(".a { animation: spin 1s linear; }")).toHaveLength(1);
  });

  it("the shipped stylesheets are clean, and tokens.css holds the durations", () => {
    const run = () => execFileSync("node", [join(__dirname, "../../scripts/check_css_motion.mjs"), __dirname]);
    expect(() => run()).not.toThrow();
    expect(readFileSync(join(__dirname, "shell/tokens.css"), "utf8")).toContain("--dur-slide: 250ms");
  });
});
