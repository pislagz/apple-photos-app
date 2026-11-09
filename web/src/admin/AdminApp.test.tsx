import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminApp from "./AdminApp";
import { jsonResponse, mockFetch } from "./testHelpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminApp", () => {
  it("shows a sign-in form when there is no session", async () => {
    mockFetch((url) => {
      if (url === "/api/me") return jsonResponse({ detail: "not signed in" }, 401);
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AdminApp />);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("rejects a non-admin account", async () => {
    mockFetch((url) => {
      if (url === "/api/me") return { username: "bob", role: "user", libraries: [] };
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AdminApp />);

    expect(await screen.findByText("This account is not an admin.")).toBeInTheDocument();
  });

  it("shows the sidebar and Libraries screen for an admin", async () => {
    mockFetch((url) => {
      if (url === "/api/me") return { username: "alice", role: "admin", libraries: [] };
      if (url === "/api/admin/libraries") return [];
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AdminApp />);

    expect(await screen.findByRole("heading", { name: "Libraries" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Access" })).toBeInTheDocument();
  });

  it("logs in and then shows the admin sidebar", async () => {
    let signedIn = false;
    mockFetch((url, init) => {
      if (url === "/api/me") {
        return signedIn ? { username: "alice", role: "admin", libraries: [] } : jsonResponse({ detail: "not signed in" }, 401);
      }
      if (url === "/api/auth/login" && init?.method === "POST") {
        signedIn = true;
        return { username: "alice", role: "admin" };
      }
      if (url === "/api/admin/libraries") return [];
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    render(<AdminApp />);
    await screen.findByRole("heading", { name: "Sign in" });

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Libraries" })).toBeInTheDocument());
  });
});
