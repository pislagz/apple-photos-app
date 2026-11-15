import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../../api";
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

const ITEM = {
  id: "p1",
  filename: "dog.jpg",
  date: "2024-01-01T00:00:00",
  is_video: false,
  is_live_photo: false,
  favorite: false,
  width: 10,
  height: 10,
  duration: null,
};

function handler(requested: string[], search: (q: string) => Response | { items: unknown[]; next_cursor: null }) {
  return (url: string) => {
    requested.push(url);
    if (url === "/api/libraries/1/albums") return { tree: [], smart: [] };
    if (url === "/api/libraries/1/summary") return { years: [], months: [], days: [] };
    if (url === "/api/libraries/1/people")
      return { people: [{ id: "pp1", name: "Dora", label: "Dora", count: 4, cover: null }] };
    if (url.startsWith("/api/libraries/1/search")) return search(new URL(url, "http://x").searchParams.get("q") ?? "");
    if (url.startsWith("/api/libraries/1/assets")) return { items: [], next_cursor: null };
    throw new Error(`unexpected request: ${url}`);
  };
}

const found = (q: string) => (q === "dog" ? { items: [ITEM], next_cursor: null } : { items: [], next_cursor: null });

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});

function renderDesktop() {
  render(
    <DesktopShell
      me={ME}
      activeLibraryId={1}
      onActiveLibraryChange={() => {}}
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
      onLogout={() => {}}
    />,
  );
}

describe("desktop search", () => {
  it("shows results for a typed query, says when nothing matches, and clearing returns to Library", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested, found));
    renderDesktop();
    const field = screen.getByRole("searchbox", { name: "Search photos" });

    fireEvent.change(field, { target: { value: "dog" } });
    expect(await findThumb("p1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Results for .dog./ })).toBeInTheDocument();
    expect(requested.some((u) => u.startsWith("/api/libraries/1/search?") && u.includes("q=dog"))).toBe(true);

    fireEvent.change(field, { target: { value: "zebra" } });
    expect(await screen.findByText(/No results for .zebra./)).toBeInTheDocument();

    fireEvent.change(field, { target: { value: "" } });
    await waitFor(() => expect(screen.queryByRole("heading", { name: /Results for/ })).not.toBeInTheDocument());
  });

  it("makes no search request while the field is empty", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested, found));
    renderDesktop();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "   " } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(requested.some((u) => u.includes("/search"))).toBe(false);
  });

  it("says the search failed and retries", async () => {
    let fail = true;
    mockFetch(handler([], (q) => (fail ? jsonResponse({ detail: "x" }, 500) : found(q))));
    renderDesktop();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "dog" } });
    expect(await screen.findByText("Couldn't search.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await findThumb("p1")).toBeInTheDocument();
  });

  it("focuses the field on Cmd+F", () => {
    mockFetch(handler([], found));
    renderDesktop();
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("focuses the field on /, but not while typing in another input", () => {
    mockFetch(handler([], found));
    renderDesktop();
    fireEvent.keyDown(window, { key: "/" });
    expect(screen.getByRole("searchbox")).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    const other = document.createElement("input");
    document.body.appendChild(other);
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(other).toHaveFocus();
    other.remove();
  });

  it("puts search in the toolbar slot, not in the sidebar", () => {
    mockFetch(handler([], found));
    renderDesktop();
    const field = screen.getByRole("searchbox");
    expect(screen.getByRole("complementary", { name: "Sidebar" })).not.toContainElement(field);
    expect(field.closest(".shell__search")).not.toBeNull();
  });

  it("keeps search in one fixed toolbar row and the title in a heading below it (#296)", async () => {
    mockFetch(handler([], found));
    renderDesktop();
    const toolbar = screen.getByTestId("shell-toolbar");
    const field = screen.getByRole("searchbox");
    expect(toolbar).toContainElement(field);
    // Library's own controls render into that row, not a second one.
    expect(await screen.findByRole("button", { name: "Zoom In" })).toBeInTheDocument();
    expect(toolbar).toContainElement(screen.getByRole("button", { name: "Zoom In" }));
    expect(document.querySelector(".desktop-library__toolbar")).toBeNull();
    // The title is a heading below the row, not inside it.
    const heading = screen.getByRole("heading", { name: "Library" });
    expect(toolbar).not.toContainElement(heading);
    expect(heading.closest(".page-heading")).not.toBeNull();
    expect(toolbar.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Filter By is the pill over the grid (#369), not part of the heading row.
    expect(screen.getByRole("button", { name: "Filter By" }).closest(".page-heading")).toBeNull();

    // Another view: same toolbar element and field, heading swaps.
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(screen.getByTestId("shell-toolbar")).toBe(toolbar);
    expect(screen.getByRole("searchbox")).toBe(field);
    expect(screen.getByRole("heading", { name: "Map" }).closest(".page-heading")).not.toBeNull();
  });
});

describe("mobile search", () => {
  it("opens from the Search tab, puts the query in the route, and lists results", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested, found));
    renderMobile();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(window.location.pathname).toBe("/search");
    expect(screen.getByText(/Search by place, person/)).toBeInTheDocument();
    expect(requested.some((u) => u.includes("/search"))).toBe(false);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "dog" } });
    // Typing alone only suggests; Search runs it.
    expect(requested.some((u) => u.includes("/search?"))).toBe(false);
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(await findThumb("p1")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/search/dog");
  });

  it("restores a search from its URL on reload", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested, found));
    window.history.replaceState({}, "", "/search/dog");
    renderMobile();
    expect(await findThumb("p1")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("dog");
  });

  it("shows empty and error states with Retry", async () => {
    let fail = true;
    mockFetch(handler([], (q) => (fail ? jsonResponse({ detail: "x" }, 500) : found(q))));
    window.history.replaceState({}, "", "/search/dog");
    renderMobile();
    expect(await screen.findByText("Couldn't search.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await findThumb("p1")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zebra" } });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(await screen.findByText(/No results for .zebra./)).toBeInTheDocument();
  });

  it("lists suggestions while typing and turns a chosen one into a removable token", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested, found));
    window.history.replaceState({}, "", "/search");
    renderMobile();
    const field = screen.getByRole("searchbox");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "do" } });
    const option = await screen.findByRole("option", { name: /Dora/ });
    expect(screen.getByRole("option", { name: /Search for .do./ })).toBeInTheDocument();
    fireEvent.click(option);
    expect(screen.getByRole("button", { name: "Remove Dora" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/search/Dora");
    await waitFor(() => expect(requested.some((u) => u.includes("q=Dora"))).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Remove Dora" }));
    expect(screen.queryByRole("button", { name: "Remove Dora" })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/search");
  });

  it("shows recent searches as cards, newest first, and keeps them on this device only", async () => {
    const requested: string[] = [];
    localStorage.setItem("pv.recentSearches", JSON.stringify(["beach", "dog"]));
    mockFetch(handler(requested, found));
    window.history.replaceState({}, "", "/search");
    renderMobile();
    const cards = screen.getAllByRole("button", { name: /^(beach|dog)$/ });
    expect(cards.map((c) => c.textContent)).toEqual(["beach", "dog"]);
    fireEvent.click(cards[1]);
    expect(await findThumb("p1")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("pv.recentSearches") ?? "[]")).toEqual(["dog", "beach"]);
    expect(requested.every((u) => !u.includes("recent"))).toBe(true);
  });

  it("clears recent searches", () => {
    localStorage.setItem("pv.recentSearches", JSON.stringify(["beach"]));
    mockFetch(handler([], found));
    window.history.replaceState({}, "", "/search");
    renderMobile();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("button", { name: "beach" })).not.toBeInTheDocument();
    expect(localStorage.getItem("pv.recentSearches")).toBeNull();
  });
});

describe("desktop suggestions", () => {
  it("opens a popover with suggestions; choosing one makes a token and filters", async () => {
    const requested: string[] = [];
    mockFetch(handler(requested, found));
    renderDesktop();
    const field = screen.getByRole("searchbox");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "dor" } });
    fireEvent.click(await screen.findByRole("option", { name: /Dora/ }));
    expect(screen.getByRole("button", { name: "Remove Dora" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /Results for .Dora./ })).toBeInTheDocument();
    expect(requested.some((u) => u.includes("q=Dora"))).toBe(true);
  });

  it("Enter runs the search at once, saves it as a recent, and shows the item count", async () => {
    mockFetch(handler([], found));
    renderDesktop();
    const field = screen.getByRole("searchbox");
    fireEvent.change(field, { target: { value: "dog" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(await screen.findByRole("heading", { name: /Results for .dog./ })).toBeInTheDocument();
    expect(await screen.findByText("1 item")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("pv.recentSearches") ?? "[]")).toEqual(["dog"]);
  });

  it("lists recents when the field is empty, and Escape clears everything", async () => {
    localStorage.setItem("pv.recentSearches", JSON.stringify(["beach"]));
    mockFetch(handler([], found));
    renderDesktop();
    const field = screen.getByRole("searchbox");
    fireEvent.focus(field);
    expect(screen.getByText("Recent Searches")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "beach" }));
    expect(await screen.findByRole("heading", { name: /Results for .beach./ })).toBeInTheDocument();
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: /Results for/ })).not.toBeInTheDocument());
    expect(field).toHaveValue("");
  });
});
