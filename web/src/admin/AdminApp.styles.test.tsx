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

  it("defines rules for the key admin classes, with a dark scheme and a phone breakpoint", () => {
    for (const cls of [".admin-app", ".admin-nav", ".admin-main", ".admin-table-wrap", ".admin-auth"]) {
      expect(css).toContain(cls);
    }
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toMatch(/@media \(max-width: 700px\)/);
  });

  it("the Users actions are a compact 2-column block on a phone (#179)", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 700px)"));
    expect(phone).toMatch(/\.admin-actions \{[^}]*grid-template-columns: repeat\(2, max-content\)/);
  });

  it("the sign-in screen carries the admin-auth class", async () => {
    mockFetch(() => jsonResponse({ detail: "not signed in" }, 401));
    render(<AdminApp />);
    const heading = await screen.findByRole("heading", { name: "Sign in" });
    expect(heading.closest("main")?.className).toBe("admin-auth");
  });
});
