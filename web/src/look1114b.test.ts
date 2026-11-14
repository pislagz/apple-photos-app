import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "shell/shell.css"), "utf8");
const rule = (sel: string) => {
  const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.[\]()]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
};

describe("1114b look fixes", () => {
  it("#390 ring is on the mobile field row, not the input", () => {
    expect(rule(".login-screen--mobile .login-card form > label:focus-within")).toMatch(/outline: 2px solid var\(--accent\)/);
    expect(rule(".login-screen--mobile .login-card input:focus-visible")).toMatch(/box-shadow: none/);
  });
  it("#393 filter pill uses the search field height", () => {
    expect(rule(".filter-pill")).toMatch(/height: var\(--size-search-field\)/);
  });
  it("#395 viewer toolbar buttons are square", () => {
    expect(rule(".desktop-viewer__topbar .toolbar-button")).toMatch(/width: 28px;\s*height: 28px/);
  });
});
