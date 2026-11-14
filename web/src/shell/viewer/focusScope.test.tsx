import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetListItem } from "../../api";
import { mockFetch } from "../../testHelpers";
import { useFakeLayout } from "../../testLayout";
import DesktopLibrary from "../library/DesktopLibrary";
import MobileViewer from "./MobileViewer";
import { makeOutsideInert, useFocusScope } from "./focusScope";

useFakeLayout();
afterEach(() => vi.unstubAllGlobals());

function item(id: string, date: string): AssetListItem {
  return { id, filename: `${id}.jpg`, date, is_video: false, is_live_photo: false, favorite: false, width: 100, height: 100, duration: null };
}

describe("makeOutsideInert (D59)", () => {
  it("marks everything outside the branch inert and releases only what it marked", () => {
    document.body.innerHTML = `
      <div id="app"><nav id="nav"><button>n</button></nav>
        <main id="main"><div id="grid"></div><div id="overlay"><button id="inside">x</button></div></main>
        <aside id="already" inert></aside></div>
      <div id="portal"></div>`;
    const release = makeOutsideInert(document.getElementById("overlay") as HTMLElement);
    const inert = (id: string) => document.getElementById(id)?.hasAttribute("inert");
    expect([inert("nav"), inert("grid"), inert("portal")]).toEqual([true, true, true]);
    expect([inert("overlay"), inert("main"), inert("app"), inert("inside")]).toEqual([false, false, false, false]);
    release();
    expect([inert("nav"), inert("grid"), inert("portal")]).toEqual([false, false, false]);
    expect(inert("already")).toBe(true);
    document.body.innerHTML = "";
  });
});

describe("useFocusScope", () => {
  function Harness({ open }: { open: boolean }) {
    const ref = useRef<HTMLDivElement | null>(null);
    useFocusScope(ref, { active: open });
    return (
      <div>
        <button>behind</button>
        <div ref={ref} tabIndex={-1} data-testid="scope">
          <button>inside</button>
        </div>
      </div>
    );
  }

  it("moves focus in, and back to what was focused when it ends", () => {
    function App({ shown }: { shown: boolean }) {
      return (
        <div>
          <button>opener</button>
          {shown && <Harness open />}
        </div>
      );
    }
    const { rerender } = render(<App shown={false} />);
    screen.getByText("opener").focus();
    rerender(<App shown />);
    expect(document.activeElement).toBe(screen.getByTestId("scope"));
    expect(screen.getByText("behind").hasAttribute("inert")).toBe(true);
    expect(screen.getByText("opener").hasAttribute("inert")).toBe(true);
    rerender(<App shown={false} />);
    expect(document.activeElement).toBe(screen.getByText("opener"));
    expect(screen.getByText("opener").hasAttribute("inert")).toBe(false);
  });
});

describe("Viewer focus (D59)", () => {
  it("desktop: the grid is inert while the Viewer is open, Esc closes, focus returns to the thumbnail", async () => {
    const items = [item("a1", "2024-05-10T10:00:00"), item("a2", "2024-05-09T10:00:00")];
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      return new Response("{}", { status: 404 });
    });
    render(<DesktopLibrary libraryId={1} initialView="all" />);
    const cells = await screen.findAllByTestId("library-cell");
    const second = cells.find((cell) => cell.getAttribute("data-asset-id") === "a2") as HTMLElement;
    fireEvent.doubleClick(second);
    const viewer = await screen.findByTestId("desktop-viewer");
    expect(viewer.contains(document.activeElement)).toBe(true);
    expect(screen.getByTestId("desktop-library-grid").closest("[inert]")).not.toBeNull();
    expect(viewer.closest("[inert]")).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("desktop-viewer")).toBeNull());
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('[data-asset-id="a2"]'));
  });

  it("desktop: after paging, focus returns to the tile of the item shown at close", async () => {
    const items = [item("a1", "2024-05-10T10:00:00"), item("a2", "2024-05-09T10:00:00")];
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets?")) return { items, next_cursor: null };
      return new Response("{}", { status: 404 });
    });
    render(<DesktopLibrary libraryId={1} initialView="all" />);
    const cells = await screen.findAllByTestId("library-cell");
    fireEvent.doubleClick(cells.find((cell) => cell.getAttribute("data-asset-id") === "a2") as HTMLElement);
    await screen.findByTestId("desktop-viewer");
    // Oldest first (#224): a2 comes before a1, so Right steps on to a1.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("desktop-viewer")).toBeNull());
    expect(document.activeElement).toBe(document.querySelector('[data-asset-id="a1"]'));
  });

  it("phone: the Info sheet makes everything it covers unfocusable and returns focus to Info", async () => {
    mockFetch(() => new Response("{}", { status: 404 }));
    render(<MobileViewer libraryId={1} items={[item("a1", "2024-05-10T10:00:00")]} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    const toggle = screen.getByLabelText("Info");
    toggle.focus();
    fireEvent.click(toggle);
    const sheet = await screen.findByTestId("viewer-info-sheet");
    // The covered toolbar, icon row and filmstrip are inert; the sheet is not.
    expect(toggle.closest("[inert]")).not.toBeNull();
    expect(screen.getByLabelText("Close").closest("[inert]")).not.toBeNull();
    expect(sheet.closest("[inert]")).toBeNull();
    expect(sheet.contains(document.activeElement)).toBe(true);

    fireEvent.click(screen.getByLabelText("Close info"));
    await waitFor(() => expect(screen.queryByTestId("viewer-info-sheet")).toBeNull());
    expect(toggle.closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(toggle);
    act(() => {});
  });
});
