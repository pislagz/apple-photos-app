import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminApp from "./AdminApp";
import { jsonResponse, mockFetch } from "./testHelpers";

const css = readFileSync(join(__dirname, "admin.css"), "utf-8");
const source = readFileSync(join(__dirname, "AdminApp.tsx"), "utf-8");

// #158: the admin entry rendered unstyled because nothing defined rules for
// its markup. The stylesheet must ship with AdminApp and cover its classes.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("admin styling (#158)", () => {
  it("AdminApp imports its own stylesheet", () => {
    expect(source).toMatch(/import "\.\/admin\.css";/);
  });

  it("defines rules for the key admin classes, with a phone breakpoint, dark values coming from tokens", () => {
    for (const cls of [".admin-app", ".admin-nav", ".admin-main", ".admin-table-wrap", ".admin-auth"]) {
      expect(css).toContain(cls);
    }
    // Dark values are token overrides in shell/tokens.css (#218), not a block here.
    expect(css).not.toContain("prefers-color-scheme");
    expect(css).toMatch(/@media \(max-width: 700px\)/);
  });

  it("the Users actions are a compact 2-column block on a phone (#179)", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 700px)"));
    expect(phone).toMatch(/\.admin-actions \{[^}]*grid-template-columns: repeat\(2, max-content\)/);
  });

  // #308: the shared controls are opt-in classes, so the existing screens keep their look.
  it("defines the shared control spec: 32px desktop, 44px phone, no pointer cursor", () => {
    expect(css).toContain("--admin-control-h: 32px");
    expect(css).toContain("--admin-control-h-touch: 44px");
    for (const cls of [".admin-btn", ".admin-input", ".admin-group", ".admin-row", ".admin-switch", ".admin-sheet", ".admin-skeleton", ".admin-saved"]) {
      expect(css).toContain(cls);
    }
    // One size system: switch, row and control sizes live in tokens; no per-screen size overrides
    expect(css).toContain("--admin-switch-w: 38px");
    expect(css).toContain("--admin-switch-h: 22px");
    expect(css).toContain("--admin-switch-w: 51px");
    expect(css).toContain("--admin-switch-h: 31px");
    expect(css).toMatch(/button\.admin-switch \{[^}]*width: var\(--admin-switch-w\);[^}]*height: var\(--admin-switch-h\)/);
    expect(css).not.toContain("admin-switch--mac");
    expect(css).toMatch(/--admin-row-h: 40px/);
    expect(css).toMatch(/\.admin-btn,[^{]*\{[^}]*height: var\(--admin-control-h\)/);
    expect(css).toMatch(/:is\(input, select\)\.admin-input|:is\(button, input, select\)\.admin-input \{[^}]*height: var\(--admin-control-h\)/);
    expect(css).toMatch(/opacity: 0\.4;\s*cursor: not-allowed/);
  });

  it("the dev controls page is only reachable in dev or with the screenshot flag", () => {
    const main = readFileSync(join(__dirname, "../main.tsx"), "utf-8");
    expect(main).toMatch(/import\.meta\.env\.DEV \|\| import\.meta\.env\.VITE_ADMIN_GALLERY === "1"/);
  });

  it("the sign-in screen carries the admin-auth class", async () => {
    mockFetch(() => jsonResponse({ detail: "not signed in" }, 401));
    render(<AdminApp />);
    const heading = await screen.findByRole("heading", { name: "Sign in" });
    expect(heading.closest("main")?.className).toBe("admin-auth");
  });
});
