import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../api";
import { jsonResponse, mockFetch, noContentResponse } from "../testHelpers";
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
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
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
    const switcher = await screen.findByLabelText("Library switcher");
    expect(switcher).toBeInTheDocument();
    // Tracker R21: the switcher sits at the very bottom of the sidebar,
    // below the account menu, not at the top -- same placement rule as the
    // bottom of the phone More tab (#90).
    expect(sidebar?.lastElementChild).toBe(switcher);
  });

  it("lets a multi-library account pick the active library from the bottom of the sidebar", async () => {
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
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
      />,
    );

    const select = await screen.findByLabelText("Library switcher");
    expect(select).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "2" } });
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
      throw new Error(`unexpected request: ${url}`);
    });
    render(
      <DesktopShell
        me={ME_RESPONSE}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
      />,
    );
  }

  it("has a Days item right after Library that shows the Days view", async () => {
    setup();
    const labels = Array.from(document.querySelectorAll(".sidebar nav .sidebar__item")).map((el) => el.textContent);
    expect(labels.slice(0, 2)).toEqual(["Library", "Days"]);

    fireEvent.click(screen.getByRole("button", { name: "Days" }));
    expect(screen.getByRole("button", { name: "Days" })).toHaveAttribute("aria-current", "page");
    // One hero per day, with the date as its caption; no Years/Months switch.
    await waitFor(() => expect(document.querySelectorAll(".desktop-library__feature-caption")).toHaveLength(2));
    expect(screen.queryByRole("tab", { name: "Years" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Library/ }));
    expect(screen.getByRole("tab", { name: "Years" })).toBeInTheDocument();
  });

  it("has no Recently Deleted, no duplicate Favorites/Videos, and labels People & Pets", () => {
    setup();
    expect(screen.queryByText("Recently Deleted")).not.toBeInTheDocument();
    expect(screen.getAllByText("Favorites")).toHaveLength(1);
    expect(screen.getAllByText("Videos")).toHaveLength(1);
    expect(screen.queryByText("Smart Albums")).not.toBeInTheDocument();
    expect(screen.getByText("People & Pets")).toBeInTheDocument();
    expect(screen.queryByText("People")).not.toBeInTheDocument();
  });
});

describe("DesktopShell Hidden password prompt (#130)", () => {
  function setup(reconfirmStatus: number) {
    const fetchMock = mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/assets")) return { items: [], next_cursor: null };
      if (url === "/api/libraries/1/albums") return { tree: [], smart: [] };
      if (url === "/api/auth/reconfirm-password") {
        return reconfirmStatus === 204 ? noContentResponse() : jsonResponse({ detail: "x" }, reconfirmStatus);
      }
      if (url === "/api/auth/lock-hidden") return noContentResponse();
      if (url === "/api/libraries/1/hidden") return { items: [], next_cursor: null };
      throw new Error(`unexpected request: ${url}`);
    });
    render(
      <DesktopShell
        me={ME_RESPONSE}
        activeLibraryId={1}
        onActiveLibraryChange={() => {}}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hidden" }));
    return fetchMock;
  }

  it("prompts, then opens Hidden on the correct password and re-locks on leaving", async () => {
    const fetchMock = setup(204);
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText("No hidden photos.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Library/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/lock-hidden")).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Hidden" }));
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });

  it("shows an inline error on a wrong password and a try-later message on 429", async () => {
    setup(401);
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect password.");
    expect(screen.queryByText("No hidden photos.")).not.toBeInTheDocument();
  });

  it("shows try-later when locked out", async () => {
    setup(429);
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/try again later/i);
  });

  it("cancel closes the prompt and stays in the Library", async () => {
    setup(204);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByText("No hidden photos.")).not.toBeInTheDocument();
  });
});

describe("DesktopShell Days double-click (#152)", () => {
  it("opens Library > All Photos, and the sidebar Days item goes back to Days", async () => {
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
      throw new Error(`unexpected request: ${url}`);
    });
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

    fireEvent.click(screen.getByRole("button", { name: "Days" }));
    await screen.findAllByRole("img");
    expect(screen.queryByRole("tab")).toBeNull();
    fireEvent.doubleClick(container.querySelector('[data-asset-id="b"]') as HTMLElement);

    await waitFor(() => expect(screen.getByRole("tab", { name: "All Photos" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("button", { name: "Library" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Days" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByTestId("desktop-viewer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Days" }));
    await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
    expect(screen.getByRole("button", { name: "Days" })).toHaveAttribute("aria-current", "page");
  });
});

describe("sidebar section labels (#105)", () => {
  it("uses small grey title case, not uppercase", () => {
    const rule = css.match(/\.sidebar__group summary \{[^}]*\}/)?.[0] ?? "";
    expect(rule).not.toContain("uppercase");
  });
});
