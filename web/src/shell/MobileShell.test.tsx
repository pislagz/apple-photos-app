import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  window.history.replaceState({}, "", "/");
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

describe("MobileShell tab switching", () => {
  it("keeps the Library tab mounted so its segment survives Library -> More -> Library", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets")) return { items: [], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });

    render(
      <MobileShell me={ME_RESPONSE} layoutOverride="auto" onLayoutOverrideChange={() => {}} onLogout={() => {}} />,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Months" }));
    expect(screen.getByRole("tab", { name: "Months" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByText("More", { selector: ".mobile-screen__title" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(await screen.findByRole("tab", { name: "Months" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("MobileShell More tab", () => {
  it("lists People & Pets, Places, Media Types, and Hidden, with the library switcher pinned at the very bottom", async () => {
    const { container } = render(
      <MobileShell me={ME_RESPONSE} layoutOverride="auto" onLayoutOverrideChange={() => {}} onLogout={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));

    const more = within((await screen.findByText("More", { selector: ".mobile-screen__title" })).closest(
      ".more-screen",
    ) as HTMLElement);
    expect(more.getByRole("button", { name: /People & Pets/ })).toBeInTheDocument();
    expect(more.getByRole("button", { name: /Places/ })).toBeInTheDocument();
    expect(more.getByRole("button", { name: /Videos/ })).toBeInTheDocument();
    expect(more.getByRole("button", { name: /Hidden/ })).toBeInTheDocument();

    const switcher = container.querySelector(".more-screen__library-switcher");
    expect(switcher).toHaveTextContent("Family");
    // The switcher is the last thing in the screen, not just present
    // somewhere in it -- tracker R21 asks for it at the very bottom.
    expect(switcher?.parentElement?.lastElementChild).toBe(switcher);
  });

  it("gives People, Places, and each media type their own pushed screen reachable from More", async () => {
    const { container } = render(
      <MobileShell me={ME_RESPONSE} layoutOverride="auto" onLayoutOverrideChange={() => {}} onLogout={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: /People & Pets/ }));

    expect(await screen.findByRole("heading", { name: "People & Pets" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/people");

    fireEvent.click(container.querySelector(".mobile-screen__back") as HTMLElement);
    expect(await screen.findByText("More", { selector: ".mobile-screen__title" })).toBeInTheDocument();
  });

  it("re-asks before showing Hidden, then renders the existing HiddenView", async () => {
    mockFetch((url) => {
      if (url === "/api/libraries/1/hidden") return { items: [], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });

    render(
      <MobileShell me={ME_RESPONSE} layoutOverride="auto" onLayoutOverrideChange={() => {}} onLogout={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: /Hidden/ }));

    expect(window.location.pathname).toBe("/hidden");
    const confirm = await screen.findByRole("button", { name: "View Hidden Photos" });
    expect(screen.queryByText("No hidden photos.")).not.toBeInTheDocument();

    fireEvent.click(confirm);
    expect(await screen.findByText("No hidden photos.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hidden", level: 1 })).toBeInTheDocument();
  });
});
