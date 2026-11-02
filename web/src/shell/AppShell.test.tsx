import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, noContentResponse } from "../testHelpers";
import AppShell from "./AppShell";

function setViewport(width: number, finePointer: boolean) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: query === "(pointer: fine)" ? finePointer : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const ME_RESPONSE = { username: "alice", role: "user", libraries: [{ id: 1, display_name: "Family" }] };

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("AppShell", () => {
  it("shows a full-screen login form on the mobile layout", async () => {
    setViewport(390, true);
    mockFetch((url) => {
      if (url === "/api/me") return jsonResponse({ detail: "not authenticated" }, 401);
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AppShell />);

    const main = await screen.findByRole("heading", { name: "Sign in" });
    expect(main.closest(".login-screen--mobile")).not.toBeNull();
  });

  it("shows a centered login card on the desktop layout", async () => {
    setViewport(1400, true);
    mockFetch((url) => {
      if (url === "/api/me") return jsonResponse({ detail: "not authenticated" }, 401);
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AppShell />);

    const heading = await screen.findByRole("heading", { name: "Sign in" });
    expect(heading.closest(".login-screen--desktop")).not.toBeNull();
  });

  it("shows a refused-access message on a 403 tailnet rejection, not a generic error", async () => {
    setViewport(1400, true);
    mockFetch((url) => {
      if (url === "/api/me") return jsonResponse({ detail: "tailnet identity not allowed" }, 403);
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AppShell />);

    expect(await screen.findByRole("heading", { name: "Access refused" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("shows a refused-access message when login itself is rejected by the tailnet allow-list", async () => {
    setViewport(1400, true);
    mockFetch((url, init) => {
      if (url === "/api/me") return jsonResponse({ detail: "not authenticated" }, 401);
      if (url === "/api/auth/login" && init?.method === "POST") {
        return jsonResponse({ detail: "tailnet identity not allowed" }, 403);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AppShell />);
    await screen.findByRole("heading", { name: "Sign in" });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Access refused" })).toBeInTheDocument();
  });

  it("shows a lockout message on a 429 from login, not a generic error", async () => {
    setViewport(1400, true);
    mockFetch((url, init) => {
      if (url === "/api/me") return jsonResponse({ detail: "not authenticated" }, 401);
      if (url === "/api/auth/login" && init?.method === "POST") {
        return jsonResponse({ detail: "too many failed attempts, try again later" }, 429);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AppShell />);
    await screen.findByRole("heading", { name: "Sign in" });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/too many sign-in attempts/i);
  });

  it("renders the mobile tab bar with only Library enabled", async () => {
    setViewport(390, true);
    mockFetch((url) => {
      if (url === "/api/me") return ME_RESPONSE;
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AppShell />);

    const nav = await screen.findByRole("navigation", { name: "Primary" });
    const library = screen.getByRole("button", { name: "Library" });
    expect(library).toBeEnabled();
    for (const label of ["Albums", "People", "Map"]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    expect(nav).toContainElement(screen.getByRole("button", { name: "Map" }));
  });

  it("renders the desktop sidebar with only Library enabled", async () => {
    setViewport(1400, true);
    mockFetch((url) => {
      if (url === "/api/me") return ME_RESPONSE;
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AppShell />);

    const sections = within(await screen.findByRole("navigation", { name: "Sections" }));
    expect(sections.getByRole("button", { name: "Library" })).toBeEnabled();
    for (const label of ["Favorites", "Recently Added", "Map", "People"]) {
      expect(sections.getByRole("button", { name: label })).toBeDisabled();
    }
  });

  it("logs out back to the login screen", async () => {
    setViewport(1400, true);
    let signedIn = true;
    mockFetch((url, init) => {
      if (url === "/api/me") return signedIn ? ME_RESPONSE : jsonResponse({ detail: "not authenticated" }, 401);
      if (url === "/api/auth/logout" && init?.method === "POST") {
        signedIn = false;
        return noContentResponse();
      }
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument());
  });
});
