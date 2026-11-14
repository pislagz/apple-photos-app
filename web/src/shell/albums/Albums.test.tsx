import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlbumsResponse, MeResponse } from "../../api";
import { findThumb, jsonResponse, mockFetch } from "../../testHelpers";
import { useFakeLayout } from "../../testLayout";
import DesktopShell from "../DesktopShell";
import MobileShell from "../MobileShell";

useFakeLayout();

const ME: MeResponse = {
  username: "alice",
  role: "user",
  libraries: [{ id: 1, display_name: "Family" }],
  layout_override: null,
};

const ALBUMS: AlbumsResponse = {
  tree: [
    {
      id: "F1",
      kind: "folder",
      title: "Trips",
      count: null,
      cover_id: null,
      children: [{ id: "A1", kind: "album", title: "Paris", count: 2, cover_id: "c1", children: [] }],
    },
    { id: "A2", kind: "album", title: "Loose", count: 1, cover_id: null, children: [] },
  ],
  smart: [{ id: "smart:favorites", title: "Favorites", count: 1, cover_id: "p1" }],
};

const ITEM = {
  id: "p1",
  filename: "p1.jpg",
  date: "2024-01-01T00:00:00",
  is_video: false,
  is_live_photo: false,
  favorite: true,
  width: 10,
  height: 10,
  duration: null,
};

function handler(requested: string[], albums: () => Response | AlbumsResponse = () => ALBUMS) {
  return (url: string) => {
    requested.push(url);
    if (url === "/api/libraries/1/albums") return albums();
    if (url.startsWith("/api/libraries/1/assets")) {
      const album = new URL(url, "http://x").searchParams.get("album");
      return { items: album ? [ITEM] : [], next_cursor: null };
    }
    if (url === "/api/libraries/1/summary") return { years: [], months: [], days: [] };
    throw new Error(`unexpected request: ${url}`);
  };
}

function renderDesktop() {
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
}

function renderMobile() {
  render(
    <MobileShell
      me={ME}
      activeLibraryId={1}
      onActiveLibraryChange={() => {}}
      layoutOverride="auto"
      onLayoutOverrideChange={() => {}}
      onLogout={() => {}}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("desktop Albums sidebar group", () => {
  it("shows the folder tree and opens an album in the grid with its title", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested));
    renderDesktop();

    expect(await screen.findByText("Trips")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Paris" }));

    expect(await screen.findByRole("heading", { name: "Paris" })).toBeInTheDocument();
    await waitFor(() => expect(requested.some((url) => url.includes("album=A1"))).toBe(true));
    expect(await findThumb("p1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paris" })).toHaveAttribute("aria-current", "page");
    // No Years/Months switch inside an album.
    expect(screen.queryByRole("tab", { name: "Years" })).not.toBeInTheDocument();
  });

  it("shows a disclosure chevron on folders, toggles them and remembers the state", async () => {
    localStorage.clear();
    mockFetch(handler([]));
    renderDesktop();

    const summary = (await screen.findByText("Trips")).closest("summary") as HTMLElement;
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(summary.querySelector(".sidebar__disclosure")).not.toBeNull();
    // Albums at the same depth get a spacer, not a chevron.
    const paris = screen.getByRole("button", { name: "Paris" });
    expect(paris.querySelector(".sidebar__disclosure")).toBeNull();
    expect(paris.querySelector(".sidebar__disclosure-spacer")).not.toBeNull();
    expect(details.open).toBe(true);

    fireEvent.click(summary);
    await waitFor(() => expect(details.open).toBe(false));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("photos-viewer.sidebar-closed-folders") ?? "[]")).toEqual(["F1"]),
    );

    cleanup();
    renderDesktop();
    const again = (await screen.findByText("Trips")).closest("details") as HTMLDetailsElement;
    expect(again.open).toBe(false);

    fireEvent.click(again.querySelector("summary") as HTMLElement);
    await waitFor(() => expect(again.open).toBe(true));
    expect(JSON.parse(localStorage.getItem("photos-viewer.sidebar-closed-folders") ?? "[]")).toEqual([]);
    localStorage.clear();
  });

  it("keeps folder rows out of the section-header style, with their own chevron", async () => {
    mockFetch(handler([]));
    renderDesktop();
    const folder = (await screen.findByText("Trips")).closest("summary") as HTMLElement;
    // Section headers are the group's own <summary>; folders are nested deeper
    // and are album-row styled.
    expect(folder.classList.contains("sidebar__item")).toBe(true);
    expect(folder.closest(".sidebar__group")?.querySelector(":scope > summary")).not.toBe(folder);
    const sectionHeaders = [...document.querySelectorAll(".sidebar__group > summary")];
    expect(sectionHeaders.length).toBeGreaterThan(0);
    expect(sectionHeaders).not.toContain(folder);
    // The chevron is a stroked SVG of its own, not the section's native triangle.
    const chevron = folder.querySelector("svg.sidebar__chevron");
    expect(chevron).not.toBeNull();
    expect(chevron?.querySelector("path")?.getAttribute("fill")).toBeNull();
    expect(chevron?.getAttribute("stroke")).toBe("currentColor");
    for (const header of sectionHeaders) expect(header.querySelector(".sidebar__chevron")).toBeNull();
  });

  it("opens Favorites as the smart album", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested));
    renderDesktop();

    fireEvent.click(await screen.findByRole("button", { name: "Favorites" }));

    await waitFor(() => expect(requested.some((url) => url.includes("album=smart%3Afavorites"))).toBe(true));
    expect(await screen.findByRole("heading", { name: "Favorites" })).toBeInTheDocument();
  });

  it("lists only the Media Types that have items, in one /albums request", async () => {
    const requested: string[] = [];
    mockFetch(
      handler(requested, () => ({
        ...ALBUMS,
        smart: [
          ...ALBUMS.smart,
          { id: "smart:videos", title: "Videos", count: 2, cover_id: "p1" },
          { id: "smart:panoramas", title: "Panoramas", count: 1, cover_id: "p1" },
        ],
      })),
    );
    renderDesktop();

    const group = (await screen.findByText("Media types")).closest("details") as HTMLElement;
    await waitFor(() => expect(within(group).getByRole("button", { name: "Videos" })).toBeInTheDocument());
    expect(within(group).getByRole("button", { name: "Panoramas" })).toBeInTheDocument();
    for (const empty of ["Selfies", "Live Photos", "Portrait", "Screenshots", "RAW"]) {
      expect(within(group).queryByRole("button", { name: empty })).not.toBeInTheDocument();
    }
    expect(requested.filter((url) => url === "/api/libraries/1/albums")).toHaveLength(1);

    fireEvent.click(within(group).getByRole("button", { name: "Videos" }));
    await waitFor(() => expect(requested.some((url) => url.includes("album=smart%3Avideos"))).toBe(true));
  });

  it("hides the Media Types group when no type has items, and while albums load or fail", async () => {
    mockFetch(handler([], () => ALBUMS)); // only Favorites
    renderDesktop();
    expect(screen.queryByText("Media types")).not.toBeInTheDocument();
    expect(await screen.findByText("Trips")).toBeInTheDocument();
    expect(screen.queryByText("Media types")).not.toBeInTheDocument();
  });

  it("hides media types whose count is 0 and shows none of the seven before albums load", async () => {
    mockFetch(
      handler([], () => ({
        ...ALBUMS,
        smart: [
          { id: "smart:videos", title: "Videos", count: 2, cover_id: "p1" },
          { id: "smart:selfies", title: "Selfies", count: 0, cover_id: null },
        ],
      })),
    );
    renderDesktop();
    expect(screen.queryByRole("button", { name: "Videos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Selfies" })).not.toBeInTheDocument();
    const group = (await screen.findByText("Media types")).closest("details") as HTMLElement;
    expect(within(group).getAllByRole("button")).toHaveLength(1);
    expect(within(group).getByRole("button", { name: "Videos" })).toBeEnabled();
  });

  it("says albums could not be loaded and retries", async () => {
    let fail = true;
    mockFetch(handler([], () => (fail ? jsonResponse({ detail: "x" }, 500) : ALBUMS)));
    renderDesktop();

    expect(await screen.findByText(/Couldn't load albums/)).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Trips")).toBeInTheDocument();
  });
});

describe("mobile Albums tab", () => {
  it("lists folders and albums, drills into a folder, and opens an album's photos", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested));
    window.history.replaceState({}, "", "/albums");
    renderMobile();

    expect(await screen.findByRole("button", { name: /Loose/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Trips/ }));
    expect(window.location.pathname).toBe("/albums/folder/F1");

    fireEvent.click(await screen.findByRole("button", { name: /Paris/ }));
    expect(window.location.pathname).toBe("/albums/A1");
    expect(await screen.findByRole("heading", { name: "Paris" })).toBeInTheDocument();
    expect(await findThumb("p1")).toBeInTheDocument();
    await waitFor(() => expect(requested.some((url) => url.includes("album=A1"))).toBe(true));
    // An album is a single grid: the zoom tabs (the Library tab's own, hidden) are not duplicated inside it.
    expect(screen.getAllByRole("tab", { name: "Years", hidden: true })).toHaveLength(1);

    // Back retraces the folder.
    fireEvent.click(screen.getByRole("button", { name: "Trips" }));
    expect(window.location.pathname).toBe("/albums/folder/F1");
  });

  it("says albums could not be loaded and retries", async () => {
    let fail = true;
    mockFetch(handler([], () => (fail ? jsonResponse({ detail: "x" }, 500) : ALBUMS)));
    window.history.replaceState({}, "", "/albums");
    renderMobile();

    expect(await screen.findByText("Couldn't load albums.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: /Loose/ })).toBeInTheDocument();
  });

  it("opens a More media type as its smart album", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested));
    window.history.replaceState({}, "", "/media/videos");
    renderMobile();

    expect(await screen.findByRole("heading", { name: "Videos" })).toBeInTheDocument();
    await waitFor(() => expect(requested.some((url) => url.includes("album=smart%3Avideos"))).toBe(true));
  });
});

describe("#223 Albums screens", () => {
  it("desktop: Albums opens the cover grid, an album shows Back and its count, Cmd [ goes back", async () => {
    mockFetch(handler([]));
    renderDesktop();
    const nav = (await screen.findAllByRole("button", { name: "Albums" }))[0];
    fireEvent.click(nav);
    const grid = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(".albums-overview__grid");
      if (!found) throw new Error("no overview yet");
      return found;
    });
    const tile = within(grid).getByRole("button", { name: /Loose/ });
    expect(tile.querySelector(".album-tile__name")).toHaveTextContent("Loose");
    fireEvent.click(tile);
    expect(await screen.findByRole("heading", { name: "Loose" })).toBeInTheDocument();
    expect(document.querySelector(".page-heading__subtitle")).toHaveTextContent("1 item");
    fireEvent.keyDown(window, { key: "[", metaKey: true });
    await waitFor(() => expect(document.querySelector(".albums-overview__grid")).not.toBeNull());
    expect(screen.queryByRole("heading", { name: "Loose" })).not.toBeInTheDocument();
  });

  it("phone: the Albums tab shows section rows, cards and Media Types", async () => {
    window.history.replaceState({}, "", "/albums");
    mockFetch((url) => {
      if (url === "/api/libraries/1/people") return { people: [] };
      return handler([])(url);
    });
    renderMobile();
    const mine = await screen.findByRole("region", { name: "My Albums" });
    expect(mine.querySelectorAll(".album-card")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Places" })).toBeInTheDocument();
    // No People section while there is nobody to show.
    expect(screen.queryByRole("region", { name: "People & Pets" })).not.toBeInTheDocument();
    // Only media types the library has.
    expect(screen.queryByRole("region", { name: "Media Types" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Places" }));
    expect(window.location.pathname).toBe("/places");
  });
});
