import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse, Person } from "../../api";
import { jsonResponse, mockFetch } from "../../testHelpers";
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

const PEOPLE: Person[] = [
  { id: "P1", name: "Ann", count: 3, cover: { asset_id: "c1", x: 0.3, y: 0.4, w: 0.2, h: 0.1 } },
  { id: "P2", name: "Ben", count: 1, cover: null },
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

    fireEvent.click(ann);
    expect(await screen.findByRole("heading", { name: "Ann" })).toBeInTheDocument();
    await waitFor(() => expect(requested.some((url) => url.includes("person=P1"))).toBe(true));
    expect(requested.some((url) => url.includes("album="))).toBe(false);
    expect(await screen.findByAltText("p1.jpg")).toBeInTheDocument();

    // The toolbar's Back button (after the sidebar row in the DOM).
    fireEvent.click(screen.getAllByRole("button", { name: /People & Pets/ }).at(-1) as HTMLElement);
    expect(await screen.findByRole("button", { name: /Ben/ })).toBeInTheDocument();
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
    expect(await screen.findByText(/No named people/)).toBeInTheDocument();
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
