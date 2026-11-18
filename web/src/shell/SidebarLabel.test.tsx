import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlbumsResponse } from "../api";
import AlbumsSidebarGroup from "./albums/AlbumsSidebarGroup";
import { SIDEBAR_TOOLTIP_DELAY_MS } from "./SidebarLabel";

// #470: sidebar rows are one line; a title that is cut off shows its full
// name in a tooltip after a hover delay, and a title that fits does not.
const LONG = "3 - 06.08.1999r. Mazury, rejs po jeziorach z rodziną";
const FOLDER = "Kasety VHS przegrane w 2004 roku od cioci Basi";
const ALBUMS: AlbumsResponse = {
  tree: [
    {
      id: "F1",
      kind: "folder",
      title: FOLDER,
      count: null,
      cover_id: null,
      children: [{ id: "A1", kind: "album", title: LONG, count: 2, cover_id: "c1", children: [] }],
    },
    { id: "A2", kind: "album", title: "Paris", count: 1, cover_id: null, children: [] },
  ],
  smart: [],
};

// jsdom does no layout: a label is "cut off" when its text is longer than 20
// characters.
function fakeWidths() {
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
    return (this.textContent ?? "").length * 7;
  });
  const client = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(140);
  return () => {
    scroll.mockRestore();
    client.mockRestore();
  };
}

function renderGroup() {
  localStorage.clear();
  render(
    <AlbumsSidebarGroup
      state={{ albums: ALBUMS, error: false, retry: () => {} }}
      libraryId={1}
      currentId={null}
      onOpen={() => {}}
    />,
  );
}

const hoverAndWait = (el: Element) => {
  fireEvent.mouseEnter(el, { clientX: 40 });
  act(() => {
    vi.advanceTimersByTime(SIDEBAR_TOOLTIP_DELAY_MS + 10);
  });
};

describe("sidebar label (#470)", () => {
  let restore: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    restore = fakeWidths();
  });
  afterEach(() => {
    cleanup();
    restore();
    vi.useRealTimers();
  });

  it("wraps every album and folder title in the truncating label", () => {
    renderGroup();
    for (const title of [FOLDER, LONG, "Paris"]) {
      const label = screen.getByText(title);
      expect(label.tagName).toBe("SPAN");
      expect(label).toHaveClass("sidebar__label");
      expect(label.closest(".sidebar__item")).not.toBeNull();
    }
    // The accessible name stays the full title.
    expect(screen.getByRole("button", { name: LONG })).toBeInTheDocument();
  });

  it("the label class truncates to one line with an ellipsis", () => {
    const css = readFileSync(join(__dirname, "shell.css"), "utf8");
    const rule = css.match(/\.sidebar__label \{([^}]*)\}/)?.[1] ?? "";
    for (const decl of ["min-width: 0", "overflow: hidden", "white-space: nowrap", "text-overflow: ellipsis"]) {
      expect(rule).toContain(decl);
    }
  });

  it("shows the full name after the hover delay only when the title is cut off", () => {
    renderGroup();
    const album = screen.getByText(LONG);
    fireEvent.mouseEnter(album, { clientX: 40 });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_TOOLTIP_DELAY_MS - 50);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent(LONG);

    fireEvent.mouseLeave(album);
    expect(screen.queryByRole("tooltip")).toBeNull();

    hoverAndWait(screen.getByText("Paris"));
    expect(screen.queryByRole("tooltip")).toBeNull();

    hoverAndWait(screen.getByText(FOLDER));
    expect(screen.getByRole("tooltip")).toHaveTextContent(FOLDER);
  });

  it("leaving before the delay, or clicking, shows nothing", () => {
    renderGroup();
    const album = screen.getByText(LONG);
    fireEvent.mouseEnter(album, { clientX: 40 });
    fireEvent.mouseLeave(album);
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_TOOLTIP_DELAY_MS * 2);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    hoverAndWait(album);
    fireEvent.mouseDown(album);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("nested folders with same-named albums show exactly one tooltip, for the hovered row (#474)", () => {
    localStorage.clear();
    const twin = (id: string) => ({ id, kind: "album" as const, title: LONG, count: 1, cover_id: null, children: [] });
    const nested: AlbumsResponse = {
      tree: [
        {
          id: "F1",
          kind: "folder",
          title: FOLDER,
          count: null,
          cover_id: null,
          children: [
            twin("A1"),
            { id: "F2", kind: "folder", title: FOLDER, count: null, cover_id: null, children: [twin("A2")] },
          ],
        },
      ],
      smart: [],
    };
    render(
      <AlbumsSidebarGroup
        state={{ albums: nested, error: false, retry: () => {} }}
        libraryId={1}
        currentId={null}
        onOpen={() => {}}
      />,
    );
    const [first, second] = screen.getAllByText(LONG);
    hoverAndWait(first);
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);

    // A missed mouseleave: the pointer is on the second twin when its
    // mouseenter arrives. The first tooltip must not stay behind.
    hoverAndWait(second);
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);

    // The pointer moving onto anything but the title closes it.
    fireEvent.mouseOver(screen.getAllByText(FOLDER)[0]);
    expect(screen.queryByRole("tooltip")).toBeNull();

    // A folder and a same-named folder inside it, hovered in turn.
    const [outer, inner] = screen.getAllByText(FOLDER);
    hoverAndWait(outer);
    hoverAndWait(inner);
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  });

  it("a cover that fails to load falls back to the album icon", () => {
    renderGroup();
    const row = screen.getByRole("button", { name: LONG });
    const img = row.querySelector("img.sidebar__cover")!;
    expect(img).not.toBeNull();
    fireEvent.error(img);
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector(".sidebar__icon")).not.toBeNull();
  });

  it("no sidebar row carries a native title or SVG <title>, and hovering leaves one tooltip (#474)", () => {
    renderGroup();
    expect(document.querySelectorAll("[title], svg title")).toHaveLength(0);
    hoverAndWait(screen.getByText(LONG));
    hoverAndWait(screen.getByText(FOLDER));
    expect(document.querySelectorAll(".sidebar-tooltip")).toHaveLength(1);
    expect(document.querySelectorAll("[title], svg title")).toHaveLength(0);
  });
});
