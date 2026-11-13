import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetListItem, MeResponse } from "../api";
import { getThumb, jsonResponse, mockFetch, noContentResponse, queryThumb } from "../testHelpers";
import MobileShell from "./MobileShell";
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
  window.history.replaceState({}, "", "/");
});

describe("MobileShell layout", () => {
  it("nests the header, scrolling content, and tab bar inside the mobile shell so only the library scroll area scrolls", async () => {
    mockFetch((url) => {
      if (url === "/api/libraries/1/summary") return { years: [], months: [], days: [] };
      if (url.startsWith("/api/libraries/1/assets")) return { items: [], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });

    const { container } = render(
      <MobileShell
        me={ME_RESPONSE}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
      />,
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

  // Fix round 2: the large "More" title and every pushed screen's title
  // (People & Pets, Places, each media type, Hidden) share this one class,
  // and inherit the body's near-black light-mode color otherwise -- they
  // need their own dark-mode color or they're unreadable on the #000
  // mobile-screen background.
  it("gives .mobile-screen__title a readable color in dark mode", () => {
    // #218: no per-component dark block. The title inherits the body's
    // --color-label, which tokens.css flips in dark mode.
    const tokens = readFileSync(join(__dirname, "tokens.css"), "utf-8");
    expect(css).toMatch(/body \{[^}]*color:\s*var\(--color-label\)/);
    expect(tokens).toMatch(/prefers-color-scheme: dark\) \{\s*:root \{[^}]*--color-label:\s*#f5f5f7/);
    expect(css).not.toMatch(/\.mobile-screen__title\s*\{[^}]*color:\s*#/);
  });
});

describe("MobileShell tab switching", () => {
  it("keeps the Library tab mounted so its segment survives Library -> More -> Library", async () => {
    mockFetch((url) => {
      if (url === "/api/libraries/1/summary") return { years: [], months: [], days: [] };
      if (url.startsWith("/api/libraries/1/assets")) return { items: [], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });

    render(
      <MobileShell
        me={ME_RESPONSE}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Months" }));
    expect(screen.getByRole("tab", { name: "Months" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByText("More", { selector: ".mobile-screen__title" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(await screen.findByRole("tab", { name: "Months" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("MobileShell Library tab re-tap (#146)", () => {
  function makeItem(id: string, date: string): AssetListItem {
    return {
      id,
      filename: `${id}.jpg`,
      date,
      is_video: false,
      is_live_photo: false,
      favorite: false,
      width: 100,
      height: 100,
      duration: null,
    };
  }

  const items = [
    makeItem("recent", "2024-05-10T10:00:00"),
    ...Array.from({ length: 20 }, (_, i) => makeItem(`jan22-${i}`, `2022-01-${String(20 - i).padStart(2, "0")}T10:00:00`)),
  ];

  function mockLibrary() {
    return mockFetch((url) => {
      if (url === "/api/libraries/1/summary") {
        const bucket = (length: number) => {
          const byKey = new Map<string, number>();
          for (const item of items) {
            const key = (item.date ?? "").slice(0, length);
            byKey.set(key, (byKey.get(key) ?? 0) + 1);
          }
          return [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
        };
        return {
          years: bucket(4).map(([key, count]) => ({ key, count, key_asset_ids: [] })),
          months: bucket(7).map(([key, count]) => ({
            key,
            count,
            key_asset_ids: items.filter((i) => (i.date ?? "").startsWith(key)).slice(0, 5).map((i) => i.id),
          })),
          days: bucket(10).map(([key, count]) => ({
            key,
            count,
            key_asset_ids: items.filter((i) => (i.date ?? "").startsWith(key)).slice(0, 1).map((i) => i.id),
          })),
        };
      }
      const match = url.match(/^\/api\/libraries\/1\/assets\?(.*)$/);
      if (match) {
        const params = new URLSearchParams(match[1]);
        const to = params.get("to");
        const pool = to ? items.filter((item) => (item.date ?? "").slice(0, 10) <= to) : items;
        return { items: pool, next_cursor: null };
      }
      throw new Error(`unexpected request: ${url}`);
    });
  }

  function renderMobile() {
    return render(
      <MobileShell
        me={ME_RESPONSE}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
      />,
    );
  }

  async function drillToOlderMonth() {
    fireEvent.click(await screen.findByRole("tab", { name: "Months" }));
    fireEvent.click(await screen.findByText("Jan 2022"));
    // Month -> Days cards -> the newest day opens All Photos at that day.
    fireEvent.click(await screen.findByText("Jan 20, 2022"));
    await waitFor(() => expect(queryThumb("recent")).toBeNull());
    expect(getThumb("jan22-0")).toBeInTheDocument();
  }

  it("returns to the newest photos when the already-active Library tab is tapped", async () => {
    mockLibrary();
    renderMobile();
    await drillToOlderMonth();

    const primary = within(screen.getByRole("navigation", { name: "Primary" }));
    expect(primary.getByRole("button", { name: "Library" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(primary.getByRole("button", { name: "Library" }));

    await waitFor(() => expect(getThumb("recent")).toBeInTheDocument());
  });

  it("only navigates, without resetting, when Library is tapped from another tab", async () => {
    mockLibrary();
    renderMobile();
    await drillToOlderMonth();

    const primary = within(screen.getByRole("navigation", { name: "Primary" }));
    fireEvent.click(primary.getByRole("button", { name: "More" }));
    expect(window.location.pathname).toBe("/more");
    fireEvent.click(primary.getByRole("button", { name: "Library" }));

    expect(window.location.pathname).toBe("/");
    expect(primary.getByRole("button", { name: "Library" })).toHaveAttribute("aria-current", "page");
    // Still on the older month: the anchor survived the round trip.
    expect(getThumb("jan22-0")).toBeInTheDocument();
    expect(queryThumb("recent")).toBeNull();
  });
});

describe("MobileShell More tab", () => {
  it("lists People & Pets, Places, Media Types, and Hidden, with the library switcher pinned at the very bottom", async () => {
    const { container } = render(
      <MobileShell
        me={ME_RESPONSE}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
      />,
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

  it("lets a multi-library account pick the active library from the bottom of More", async () => {
    const onActiveLibraryChange = vi.fn();
    const twoLibraries = { ...ME_RESPONSE, libraries: [{ id: 1, display_name: "Family" }, { id: 2, display_name: "Travel" }] };
    const { container } = render(
      <MobileShell
        me={twoLibraries}
        activeLibraryId={1}
        onActiveLibraryChange={onActiveLibraryChange}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));

    const switcher = container.querySelector(".more-screen__library-switcher");
    const select = switcher?.querySelector("select") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(switcher?.parentElement?.lastElementChild).toBe(switcher);

    fireEvent.change(select, { target: { value: "2" } });
    expect(onActiveLibraryChange).toHaveBeenCalledWith(2);
  });

  it("gives People, Places, and each media type their own pushed screen reachable from More", async () => {
    const { container } = render(
      <MobileShell
        me={ME_RESPONSE}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: /People & Pets/ }));

    expect(await screen.findByRole("heading", { name: "People & Pets" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/people");

    fireEvent.click(container.querySelector(".mobile-screen__back") as HTMLElement);
    expect(await screen.findByText("More", { selector: ".mobile-screen__title" })).toBeInTheDocument();
  });

  function renderMobile() {
    return render(
      <MobileShell
        me={ME_RESPONSE}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
      />,
    );
  }

  function hiddenFetch(reconfirmStatus: number) {
    return mockFetch((url) => {
      if (url === "/api/libraries/1/summary") return { years: [], months: [], days: [] };
      if (url === "/api/auth/reconfirm-password") {
        return reconfirmStatus === 204 ? noContentResponse() : jsonResponse({ detail: "x" }, reconfirmStatus);
      }
      if (url === "/api/auth/lock-hidden") return noContentResponse();
      if (url === "/api/libraries/1/hidden") return { items: [], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });
  }

  function openHidden() {
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: /Hidden/ }));
  }

  it("asks for the password before showing Hidden, then renders HiddenView", async () => {
    const fetchMock = hiddenFetch(204);
    renderMobile();
    openHidden();

    expect(window.location.pathname).toBe("/hidden");
    const input = await screen.findByLabelText("Password");
    expect(screen.queryByText("No hidden photos.")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/libraries/1/hidden")).toBe(false);

    fireEvent.change(input, { target: { value: "hunter2hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText("No hidden photos.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hidden", level: 1 })).toBeInTheDocument();
    const reconfirm = fetchMock.mock.calls.find(([url]) => url === "/api/auth/reconfirm-password");
    expect(JSON.parse(reconfirm?.[1]?.body as string)).toEqual({ password: "hunter2hunter2" });
  });

  it("shows an inline error for a wrong password and stays locked", async () => {
    hiddenFetch(401);
    renderMobile();
    openHidden();

    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect password.");
    expect(screen.queryByText("No hidden photos.")).not.toBeInTheDocument();
  });

  it("shows a try-later message when locked out", async () => {
    hiddenFetch(429);
    renderMobile();
    openHidden();

    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/try again later/i);
  });

  it("cancel returns to More", async () => {
    hiddenFetch(204);
    renderMobile();
    openHidden();

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(window.location.pathname).toBe("/more");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("re-locks on leaving Hidden and asks again next time", async () => {
    const fetchMock = hiddenFetch(204);
    renderMobile();
    openHidden();
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await screen.findByText("No hidden photos.");

    fireEvent.click(document.querySelector(".mobile-screen__back") as HTMLElement);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/lock-hidden")).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /Hidden/ }));
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });
});
