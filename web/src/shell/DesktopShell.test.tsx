import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../api";
import { mockFetch } from "../testHelpers";
import DesktopShell from "./DesktopShell";
import { useFakeLayout } from "../testLayout";

// Virtualized grids need a sized viewport; jsdom has none (#88).
useFakeLayout();

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
      <DesktopShell
        me={ME_RESPONSE}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        onLogout={() => {}}
      />,
    );

    const shell = container.querySelector(".shell--desktop");
    expect(shell).not.toBeNull();
    const sidebar = shell?.querySelector(".sidebar");
    expect(sidebar).not.toBeNull();
    const main = shell?.querySelector(".shell__main");
    expect(main).not.toBeNull();
    const content = main?.querySelector(".shell__content");
    expect(content).not.toBeNull();
    // The Library's own scroll area is nested inside the bounded content
    // area, not a sibling of it -- that's what keeps the sidebar and
    // toolbar from scrolling off-screen with the grid.
    expect(content?.querySelector(".desktop-library__grid")).not.toBeNull();
    // #292: the library switcher lives in the account menu now, not as a
    // floating line under it.
    expect(screen.queryByLabelText("Library switcher")).not.toBeInTheDocument();
    expect(sidebar?.lastElementChild?.querySelector(".account-menu__row-trigger")).not.toBeNull();
  });

  it("lets a multi-library account pick the active library from the account menu", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets")) return { items: [], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });

    const onActiveLibraryChange = vi.fn();
    const twoLibraries = { ...ME_RESPONSE, libraries: [{ id: 1, display_name: "Family" }, { id: 2, display_name: "Travel" }] };
    render(
      <DesktopShell
        me={twoLibraries}
        activeLibraryId={1}
        onActiveLibraryChange={onActiveLibraryChange}
        onLogout={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Library/ }));
    expect(screen.getByRole("menuitemradio", { name: "Family" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Travel" }));
    expect(onActiveLibraryChange).toHaveBeenCalledWith(2);
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

describe("DesktopShell sidebar (#127, #128, #129)", () => {
  const asset = (id: string, date: string) => ({
    id,
    filename: `${id}.jpg`,
    date,
    is_video: false,
    favorite: false,
    duration: null,
  });

  function setup() {
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets")) {
        return {
          items: [asset("a1", "2024-05-02T10:00:00"), asset("a2", "2024-05-02T09:00:00"), asset("a3", "2024-05-01T09:00:00")],
          next_cursor: null,
        };
      }
      if (url.startsWith("/api/libraries/1/summary")) {
        return {
          years: [],
          months: [],
          days: [
            { key: "2024-05-01", count: 1, key_asset_ids: ["a3"] },
            { key: "2024-05-02", count: 2, key_asset_ids: ["a1"] },
          ],
        };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    render(
      <DesktopShell
        me={ME_RESPONSE}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        onLogout={() => {}}
      />,
    );
  }

  it("has no Days item: Library, Recently Added, Favorites lead, under sentence-case titles", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Days" })).toBeNull();
    const labels = Array.from(document.querySelectorAll(".sidebar nav .sidebar__item")).map((el) => el.textContent);
    expect(labels).toEqual(["Library", "Recently Added", "Favorites", "People & Pets", "Map", "Albums"]);
    const titles = Array.from(document.querySelectorAll(".sidebar__group > summary")).map((el) => el.textContent);
    expect(titles.slice(0, 2)).toEqual(["Photos", "Collections"]);
    expect(titles).toContain("Utilities");
  });
});

const DAYS = [
  { key: "2024-05-09", count: 1, key_asset_ids: ["b"] },
  { key: "2024-05-10", count: 1, key_asset_ids: ["a"] },
];

describe("DesktopShell Library reset (#167)", () => {
  it("clicking Library while on Library > Months resets to the default All Photos view (#167, #265)", async () => {
    const items = ["a", "b"].map((id, i) => ({
      id,
      filename: `${id}.jpg`,
      date: `2024-05-${10 - i}T10:00:00`,
      is_video: false,
      is_live_photo: false,
      favorite: false,
      width: 100,
      height: 100,
      duration: null,
    }));
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets")) return { items, next_cursor: null };
      if (url.startsWith("/api/libraries/1/summary")) return { years: [], months: [], days: DAYS };
      throw new Error(`unexpected request: ${url}`);
    });
    render(
      <DesktopShell
        me={ME_RESPONSE}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        onLogout={() => {}}
      />,
    );
    await screen.findAllByRole("img");
    fireEvent.click(screen.getByRole("tab", { name: "Months" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Months" })).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "All Photos" })).toHaveAttribute("aria-selected", "true"));
  });
});

describe("sidebar resize (#217)", () => {
  it("resizes with the keyboard within 190-300 and remembers the width", () => {
    mockFetch(() => ({ items: [], next_cursor: null, years: [], months: [], days: [], tree: [], smart: [] }));
    localStorage.removeItem("photos-viewer.sidebar-width");
    const { container } = render(
      <DesktopShell
        me={ME_RESPONSE}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        onLogout={() => {}}
      />,
    );
    const shell = container.querySelector(".shell--desktop") as HTMLElement;
    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("220px");
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("230px");
    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("300px");
    expect(localStorage.getItem("photos-viewer.sidebar-width")).toBe("300");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("190px");
    fireEvent.doubleClick(handle);
    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("220px");
  });
});

describe("sidebar section labels (#105)", () => {
  it("uses small grey title case, not uppercase", () => {
    const rule = css.match(/\.sidebar__group > summary \{[^}]*\}/)?.[0] ?? "";
    expect(rule).not.toContain("uppercase");
  });
});

describe("sidebar toggle hover (#200)", () => {
  it("uses a theme variable that has a dark-mode value", () => {
    expect(css).toMatch(/\.sidebar-toggle:hover:not\(:disabled\) \{[^}]*var\(--sidebar-toggle-hover\)/);
    const tokens = readFileSync(join(__dirname, "tokens.css"), "utf-8");
    expect(tokens).toMatch(/prefers-color-scheme: dark\) \{\s*:root \{[^}]*--sidebar-toggle-hover: rgba\(255/);
  });
});

describe("sidebar toggle is never covered (#349)", () => {
  it("stacks above the toolbar row so a hidden sidebar can be reopened", () => {
    const z = (sel: RegExp) => Number(css.match(sel)?.[1]);
    const toggle = z(/\.sidebar-toggle \{[^}]*z-index:\s*(\d+)/);
    const toolbar = z(/\n\.shell__toolbar \{[^}]*z-index:\s*(\d+)/);
    expect(toggle).toBeGreaterThan(toolbar);
  });
});

describe("DesktopShell with no library (#263)", () => {
  const noLibrary = (role: "admin" | "user"): MeResponse => ({ ...ME_RESPONSE, role, libraries: [] });
  const props = {
    onActiveLibraryChange: () => {},
    onLogout: () => {},
  };

  it("welcomes an admin with a way to add a library, and no developer text", () => {
    mockFetch(() => []);
    render(<DesktopShell me={noLibrary("admin")} {...props} />);
    expect(screen.getByRole("heading", { name: "Welcome to Photos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a Library" })).toHaveAttribute("href", "/admin");
    expect(document.body.textContent).not.toMatch(/later phase/i);
  });

  it("tells a user to ask their admin, without a stray Library caption", () => {
    mockFetch(() => []);
    render(<DesktopShell me={noLibrary("user")} {...props} />);
    expect(screen.getByText(/Ask the person who set up Photos/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add a Library" })).toBeNull();
    expect(screen.queryByLabelText("Library switcher")).toBeNull();
  });
});

describe("narrow sidebar overlay (#392)", () => {
  it("keeps the toggle enabled, opens over the content, closes on Escape, outside press and item choice", () => {
    mockFetch(() => ({ items: [], next_cursor: null, years: [], months: [], days: [], tree: [], smart: [] }));
    vi.stubGlobal("innerWidth", 800);
    const { container } = render(
      <DesktopShell
        me={ME_RESPONSE}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
      />,
    );
    const shell = container.querySelector(".shell--desktop") as HTMLElement;
    const toggle = screen.getByRole("button", { name: "Show sidebar" });
    expect(toggle).not.toBeDisabled();
    expect(shell.className).not.toContain("overlay-open");
    fireEvent.click(toggle);
    expect(shell.className).toContain("shell--sidebar-overlay-open");
    expect(screen.getByRole("button", { name: "Hide sidebar" })).toHaveProperty("ariaExpanded", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(shell.className).not.toContain("overlay-open");
    // Ctrl+Alt+S with the physical key opens it (Mac Option rewrites event.key).
    fireEvent.keyDown(window, { key: "ß", code: "KeyS", ctrlKey: true, altKey: true });
    expect(shell.className).toContain("overlay-open");
    fireEvent.pointerDown(container.querySelector(".shell__main") as Element);
    expect(shell.className).not.toContain("overlay-open");
    fireEvent.click(toggle);
    fireEvent.click(container.querySelector("aside .sidebar__item:not(:disabled)") as Element);
    expect(shell.className).not.toContain("overlay-open");
  });
});
