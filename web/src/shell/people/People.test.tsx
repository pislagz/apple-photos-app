import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse, Person } from "../../api";
import { findThumb, jsonResponse, mockFetch } from "../../testHelpers";
import { useFakeLayout } from "../../testLayout";
import DesktopShell from "../DesktopShell";
import MobileShell from "../MobileShell";
import { FaceCircle } from "./PeopleGrid";

useFakeLayout();

const ME: MeResponse = {
  username: "alice",
  role: "user",
  libraries: [{ id: 1, display_name: "Family" }],
  layout_override: null,
};

const PEOPLE: Person[] = [
  { id: "P1", name: "Ann", label: "Ann", count: 3, cover: { asset_id: "c1", x: 0.3, y: 0.4, w: 0.2, h: 0.1 } },
  { id: "P2", name: "Ben", label: "Ben", count: 1, cover: null },
  { id: "P3", name: null, label: "Person A", count: 7, cover: { asset_id: "c3", x: 0.5, y: 0.5, w: 0.3, h: 0.3 } },
];

const ITEM = {
  id: "p1",
  filename: "p1.jpg",
  date: "2024-01-01T00:00:00",
  is_video: false,
  is_live_photo: false,
  favorite: false,
  width: 10,
  height: 10,
  duration: null,
};

function handler(requested: string[], people: () => Response | { people: Person[] } = () => ({ people: PEOPLE })) {
  return (url: string) => {
    requested.push(url);
    if (url === "/api/libraries/1/people") return people();
    if (url === "/api/libraries/1/albums") return { tree: [], smart: [] };
    if (url.startsWith("/api/libraries/1/assets")) {
      const person = new URL(url, "http://x").searchParams.get("person");
      return { items: person ? [ITEM] : [], next_cursor: null };
    }
    if (url === "/api/libraries/1/summary") return { years: [], months: [], days: [] };
    throw new Error(`unexpected request: ${url}`);
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

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

describe("desktop People & Pets", () => {
  it("shows circular faces with names, crops the cover thumb, and opens a person's photos", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested));
    renderDesktop();

    fireEvent.click(screen.getByRole("button", { name: "People & Pets" }));
    const ann = await screen.findByRole("button", { name: /Ann/ });
    expect(screen.getByRole("button", { name: /Ben/ })).toBeInTheDocument();
    const img = ann.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/api/libraries/1/thumb/c1?size=grid2x");
    expect(img.style.width).toBe(`${100 / (0.2 * 1.8)}%`);

    // An unnamed face group comes after the named people, with a muted
    // generated label instead of a name.
    const buttons = screen.getAllByRole("button", { name: /Ann|Ben|Person A/ });
    expect(buttons.map((b) => b.querySelector(".people-grid__name")?.textContent)).toEqual(["Ann", "Ben", "Person A"]);
    expect(buttons[2].querySelector(".people-grid__name--unnamed")).not.toBeNull();
    expect(buttons[0].querySelector(".people-grid__name--unnamed")).toBeNull();

    fireEvent.click(ann);
    expect(await screen.findByRole("heading", { name: "Ann" })).toBeInTheDocument();
    await waitFor(() => expect(requested.some((url) => url.includes("person=P1"))).toBe(true));
    expect(requested.some((url) => url.includes("album="))).toBe(false);
    expect(await findThumb("p1")).toBeInTheDocument();

    // The toolbar's Back button (after the sidebar row in the DOM).
    fireEvent.click(screen.getAllByRole("button", { name: /People & Pets/ }).at(-1) as HTMLElement);
    expect(await screen.findByRole("button", { name: /Ben/ })).toBeInTheDocument();
  });

  it("opens an unnamed face group through person=", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested));
    renderDesktop();
    fireEvent.click(screen.getByRole("button", { name: "People & Pets" }));
    fireEvent.click(await screen.findByRole("button", { name: /Person A/ }));
    expect(await screen.findByRole("heading", { name: "Person A" })).toBeInTheDocument();
    await waitFor(() => expect(requested.some((url) => url.includes("person=P3"))).toBe(true));
    expect(await findThumb("p1")).toBeInTheDocument();
  });

  it("uses the same generated label in the list and on the page", async () => {
    const people: Person[] = [
      ...PEOPLE,
      { id: "P4", name: null, label: "Person B", count: 2, cover: null },
    ];
    mockFetch(handler([], () => ({ people })));
    renderDesktop();
    fireEvent.click(screen.getByRole("button", { name: "People & Pets" }));
    const names = (await screen.findAllByRole("button", { name: /Person/ })).map(
      (b) => b.querySelector(".people-grid__name")?.textContent,
    );
    expect(names).toEqual(["Person A", "Person B"]);
    fireEvent.click(screen.getByRole("button", { name: /Person B/ }));
    expect(await screen.findByRole("heading", { name: "Person B" })).toBeInTheDocument();
  });

  it("says people could not be loaded and retries", async () => {
    let fail = true;
    mockFetch(handler([], () => (fail ? jsonResponse({ detail: "x" }, 500) : { people: PEOPLE })));
    renderDesktop();

    fireEvent.click(screen.getByRole("button", { name: "People & Pets" }));
    expect(await screen.findByText(/Couldn't load people/)).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: /Ann/ })).toBeInTheDocument();
  });

  it("says so when no one is named", async () => {
    mockFetch(handler([], () => ({ people: [] })));
    renderDesktop();
    fireEvent.click(screen.getByRole("button", { name: "People & Pets" }));
    expect(await screen.findByText(/No people/)).toBeInTheDocument();
  });
});

describe("mobile People & Pets", () => {
  it("opens a person on its own route and Back returns to the grid", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested));
    window.history.replaceState({}, "", "/people");
    renderMobile();

    fireEvent.click(await screen.findByRole("button", { name: /Ann/ }));
    expect(window.location.pathname).toBe("/people/P1");
    expect(await screen.findByRole("heading", { name: "Ann" })).toBeInTheDocument();
    await waitFor(() => expect(requested.some((url) => url.includes("person=P1"))).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: /People & Pets/ }));
    expect(window.location.pathname).toBe("/people");
    expect(await screen.findByRole("button", { name: /Ben/ })).toBeInTheDocument();
  });

  it("opens a person directly from a reloaded deep link", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested));
    window.history.replaceState({}, "", "/people/P1");
    renderMobile();

    expect(await screen.findByRole("heading", { name: "Ann" })).toBeInTheDocument();
    await waitFor(() => expect(requested.some((url) => url.includes("person=P1"))).toBe(true));
  });

  it("opens an unnamed face group from the grid and from a deep link", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested));
    window.history.replaceState({}, "", "/people");
    renderMobile();
    fireEvent.click(await screen.findByRole("button", { name: /Person A/ }));
    expect(window.location.pathname).toBe("/people/P3");
    expect(await screen.findByRole("heading", { name: "Person A" })).toBeInTheDocument();
    await waitFor(() => expect(requested.some((url) => url.includes("person=P3"))).toBe(true));
  });

  it("shows a failure with Retry", async () => {
    let fail = true;
    mockFetch(handler([], () => (fail ? jsonResponse({ detail: "x" }, 500) : { people: PEOPLE })));
    window.history.replaceState({}, "", "/people");
    renderMobile();

    expect(await screen.findByText(/Couldn't load people/)).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: /Ann/ })).toBeInTheDocument();
  });
});

describe("FaceCircle size (#193)", () => {
  const cover = { asset_id: "c1", x: 0.3, y: 0.4, w: 0.1, h: 0.1 };
  const srcFor = (w: number, dpr: number) => {
    vi.stubGlobal("devicePixelRatio", dpr);
    const { container, unmount } = render(<FaceCircle libraryId={1} cover={{ ...cover, w }} />);
    const src = container.querySelector("img")?.getAttribute("src");
    unmount();
    return src;
  };
  afterEach(() => vi.unstubAllGlobals());

  it("uses preview only when the face has fewer pixels than the circle needs", () => {
    // 140 CSS px circle, face fills 1/1.8 of it: ~78 device px at 1x, ~156 at 2x, ~233 at 3x.
    const preview = "/api/libraries/1/thumb/c1?size=preview";
    const grid2x = "/api/libraries/1/thumb/c1?size=grid2x";
    expect(srcFor(0.1, 1)).toBe(preview); // 60 px < 78
    expect(srcFor(0.14, 1)).toBe(grid2x); // 84 px >= 78
    expect(srcFor(0.2, 2)).toBe(preview); // 120 px < 156
    expect(srcFor(0.3, 2)).toBe(grid2x); // 180 px >= 156
    expect(srcFor(0.3, 3)).toBe(preview); // 180 px < 233
    expect(srcFor(0.4, 3)).toBe(grid2x); // 240 px >= 233
  });
});
