import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../api";
import { mockFetch } from "../testHelpers";
import DesktopShell from "./DesktopShell";

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

describe("DesktopShell layout", () => {
  it("nests the sidebar and scrolling library grid inside the desktop shell so only the grid scrolls", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets")) return { items: [], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });

    const { container } = render(
      <DesktopShell me={ME_RESPONSE} layoutOverride="auto" onLayoutOverrideChange={() => {}} onLogout={() => {}} />,
    );

    const shell = container.querySelector(".shell--desktop");
    expect(shell).not.toBeNull();
    expect(shell?.querySelector(".sidebar")).not.toBeNull();
    const main = shell?.querySelector(".shell__main");
    expect(main).not.toBeNull();
    const content = main?.querySelector(".shell__content");
    expect(content).not.toBeNull();
    // The Library's own scroll area is nested inside the bounded content
    // area, not a sibling of it -- that's what keeps the sidebar and
    // toolbar from scrolling off-screen with the grid.
    expect(content?.querySelector(".desktop-library__grid")).not.toBeNull();
    expect(await screen.findByLabelText("Library switcher")).toBeInTheDocument();
  });

  // jsdom does no real layout (see test-setup.ts), so this asserts the CSS
  // source directly instead of a computed height/overflow that jsdom would
  // never actually apply: the desktop shell fills the viewport and clips
  // its content area, so `.desktop-library__grid` is the only thing that
  // scrolls.
  it("bounds the desktop shell to the viewport and clips the content area", () => {
    const shellRule = css.match(/\.shell--desktop\s*\{[^}]*\}/)?.[0] ?? "";
    expect(shellRule).toMatch(/height:\s*100dvh/);

    const contentRule = css.match(/\.shell--desktop \.shell__content\s*\{[^}]*\}/)?.[0] ?? "";
    expect(contentRule).toMatch(/flex:\s*1/);
    expect(contentRule).toMatch(/min-height:\s*0/);
    expect(contentRule).toMatch(/overflow:\s*hidden/);

    const gridRule = css.match(/\.desktop-library__grid\s*\{[^}]*\}/)?.[0] ?? "";
    expect(gridRule).toMatch(/overflow-y:\s*auto/);
  });
});
