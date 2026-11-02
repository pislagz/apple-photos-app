import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../api";
import { mockFetch } from "../testHelpers";
import MobileShell from "./MobileShell";

// Vitest mocks plain CSS imports (no stylesheet to attach them to in
// jsdom), so read the source directly instead.
const css = readFileSync(join(__dirname, "shell.css"), "utf-8");

const ME_RESPONSE: MeResponse = {
  username: "alice",
  role: "user",
  libraries: [{ id: 1, display_name: "Family" }],
  layout_override: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MobileShell layout", () => {
  it("nests the header, scrolling content, and tab bar inside the mobile shell so only the library scroll area scrolls", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets")) return { items: [], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });

    const { container } = render(
      <MobileShell me={ME_RESPONSE} layoutOverride="auto" onLayoutOverrideChange={() => {}} onLogout={() => {}} />,
    );

    const shell = container.querySelector(".shell--mobile");
    expect(shell).not.toBeNull();
    expect(shell?.querySelector(".shell__header")).not.toBeNull();
    expect(shell?.querySelector(".shell__content")).not.toBeNull();
    expect(shell?.querySelector(".tab-bar")).not.toBeNull();
    // The library's own scroll area is nested inside the bounded content
    // area, not a sibling of it -- that's what keeps the header and tab
    // bar from scrolling off-screen with the grid.
    const content = shell?.querySelector(".shell__content");
    expect(content?.querySelector(".mobile-library__scroll")).not.toBeNull();
    expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  // jsdom does no real layout (see test-setup.ts), so this asserts the CSS
  // source directly instead of a computed height/overflow that jsdom would
  // never actually apply: the mobile shell fills the viewport and clips its
  // content area, so the Library's own `.mobile-library__scroll` is the
  // only thing that scrolls.
  it("bounds the mobile shell to the viewport and clips the content area", () => {
    const shellRule = css.match(/\.shell--mobile\s*\{[^}]*\}/)?.[0] ?? "";
    expect(shellRule).toMatch(/height:\s*100dvh/);
    expect(shellRule).toMatch(/flex-direction:\s*column/);

    const contentRule = css.match(/\.shell--mobile \.shell__content\s*\{[^}]*\}/)?.[0] ?? "";
    expect(contentRule).toMatch(/flex:\s*1/);
    expect(contentRule).toMatch(/min-height:\s*0/);
    expect(contentRule).toMatch(/overflow:\s*hidden/);
  });
});
