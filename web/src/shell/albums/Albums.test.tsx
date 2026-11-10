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

    const group = (await screen.findByText("Media Types")).closest("details") as HTMLElement;
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
    expect(await screen.findByText("Trips")).toBeInTheDocument();
    expect(screen.queryByText("Media Types")).not.toBeInTheDocument();
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
