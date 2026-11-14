import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetListItem, MeResponse } from "../api";
import { mockFetch } from "../testHelpers";
import { useFakeLayout } from "../testLayout";
import DesktopShell from "./DesktopShell";
import DesktopViewer from "./viewer/DesktopViewer";
import MobileViewer from "./viewer/MobileViewer";

useFakeLayout();
const css = readFileSync(join(__dirname, "shell.css"), "utf-8");

const ME: MeResponse = {
  username: "alice",
  role: "user",
  libraries: [{ id: 1, display_name: "Family" }],
  layout_override: null,
};

const ITEM: AssetListItem = {
  id: "a1",
  filename: "IMG_4242.HEIC",
  date: "2024-05-10T10:00:00",
  is_video: false,
  is_live_photo: false,
  favorite: false,
  width: 100,
  height: 100,
  duration: null,
};

function routes(url: string) {
  if (url.startsWith("/api/libraries/1/assets/a1")) {
    return { id: "a1", title: "Golden Gate", date_created: ITEM.date, has_edited: false, original_filesize: 1234, people: [], albums: [] };
  }
  if (url.startsWith("/api/libraries/1/assets")) return { items: [ITEM], next_cursor: null };
  throw new Error(`unexpected request: ${url}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("alt text", () => {
  it.each([
    ["mobile", MobileViewer],
    ["desktop", DesktopViewer],
  ] as const)("%s viewer uses the title once loaded, never the filename", async (_name, Viewer) => {
    mockFetch(routes);
    render(<Viewer libraryId={1} items={[ITEM]} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    const stage = screen.getByTestId(_name === "mobile" ? "mobile-viewer-stage" : "desktop-viewer-stage");
    const img = () => stage.querySelector("img") as HTMLImageElement;
    expect(img().alt).toBe("Photo from May 10, 2024");
    await waitFor(() => expect(img().alt).toBe("Golden Gate"));
    expect(img().alt).not.toContain("IMG_4242");
  });

  it("grid thumbnails get a date alt, not the filename", async () => {
    mockFetch(routes);
    render(
      <DesktopShell
        me={ME}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
      />,
    );
    const thumb = await screen.findByAltText("Photo from May 10, 2024");
    expect(thumb.getAttribute("alt")).not.toMatch(/IMG_/);
  });
});

describe("keyboard", () => {
  it("Escape closes the mobile viewer (external keyboard)", () => {
    mockFetch(routes);
    const onClose = vi.fn();
    render(<MobileViewer libraryId={1} items={[ITEM]} index={0} onIndexChange={() => {}} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape inside a text field does not close the viewer", () => {
    mockFetch(routes);
    const onClose = vi.fn();
    render(<DesktopViewer libraryId={1} items={[ITEM]} index={0} onIndexChange={() => {}} onClose={onClose} />);
    const input = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    input.remove();
  });

  it("the sidebar toggle collapses it out of the Tab order and remembers the choice", async () => {
    mockFetch(routes);
    const { container } = render(
      <DesktopShell
        me={ME}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
      />,
    );
    const sidebar = container.querySelector(".sidebar") as HTMLElement;
    const toggle = screen.getByRole("button", { name: "Hide sidebar" });
    // The toggle is the first Tab stop, ahead of the sidebar.
    expect(container.querySelector("button")).toBe(toggle);
    expect(sidebar.hasAttribute("inert")).toBe(false);
    fireEvent.click(toggle);
    expect(sidebar.hasAttribute("inert")).toBe(true);
    expect(screen.getByRole("button", { name: "Show sidebar" }).getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".shell--sidebar-collapsed")).not.toBeNull();
    expect(localStorage.getItem("photos-viewer.sidebar-collapsed")).toBe("1");
    // #349: the same toggle brings it back.
    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(sidebar.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
    expect(localStorage.getItem("photos-viewer.sidebar-collapsed")).toBe("0");
  });
});

describe("focus ring and motion CSS", () => {
  it("has a global :focus-visible ring and never removes outlines on controls", () => {
    expect(css).toMatch(/:focus-visible\s*{[^}]*outline:\s*2px solid var\(--accent\)/);
    // Only the search input (the ring is drawn around the whole field) and the programmatically focused viewer may set outline: none.
    const nones = css.match(/[^{}]+{[^}]*outline:\s*none/g) ?? [];
    expect(nones.map((rule) => rule.trim().split("\n")[0])).toEqual([
      ".search-box__input {",
      ".search-box__input:focus-visible {",
      ".desktop-viewer:focus {",
    ]);
  });

  it("keeps a forced-colors-visible outline on fields whose ring is a box-shadow", () => {
    // Apple-style field rings use box-shadow, which forced-colors mode removes; a transparent outline stays visible there.
    const adminCss = readFileSync(join(__dirname, "../admin/admin.css"), "utf-8");
    expect(css).toMatch(/\.login-card input:focus-visible\s*{\s*outline:\s*2px solid transparent/);
    expect(adminCss).toMatch(/\.admin-input:focus-visible\s*{[^}]*outline:\s*2px solid transparent/);
  });

  it("switches motion off under prefers-reduced-motion", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toMatch(/animation-duration:\s*0\.001ms !important/);
    expect(block).toMatch(/transition-duration:\s*0\.001ms !important/);
  });
});
