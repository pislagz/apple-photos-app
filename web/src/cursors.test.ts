import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

// #255: Photos keeps the arrow on buttons and menu items. A `cursor: pointer`
// on one control (or on an inner element) makes the cursor flicker between
// the hand and the arrow as it crosses padding and gaps.
describe("cursor rule", () => {
  it("no stylesheet sets cursor: pointer", () => {
    const offenders = stylesheets(__dirname).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, index) => ({ file, line: index + 1, text: line }))
        .filter(({ text }) => /cursor:\s*pointer/.test(text)),
    );
    expect(offenders).toEqual([]);
  });

  it("buttons, menu items and tabs default to the arrow", () => {
    const css = readFileSync(join(__dirname, "shell/shell.css"), "utf8");
    const rule = css.match(/button,\s*summary,[\s\S]*?\{\s*cursor: default;\s*\}/);
    expect(rule?.[0]).toMatch(/\[role="menuitem"\]/);
    expect(rule?.[0]).toMatch(/\[role="tab"\]/);
  });
});
