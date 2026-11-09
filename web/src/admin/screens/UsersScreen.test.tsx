import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../testHelpers";
import UsersScreen from "./UsersScreen";

const USER_A = { id: 1, username: "alice", role: "admin", disabled: false, created_at: "2026-01-01" };
const USER_B = { id: 2, username: "bob", role: "user", disabled: false, created_at: "2026-01-01" };
const LIBRARY = { id: 10, display_name: "Family", path: "/libraries/Family.photoslibrary", created_at: "2026-01-01" };
const MATRIX = { users: [USER_A, USER_B], libraries: [LIBRARY], assignments: { "1": [10], "2": [] } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UsersScreen", () => {
  it("lists users without the access matrix", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/access-matrix") return MATRIX;
      if (url === "/api/admin/invites") return [];
      throw new Error(`unexpected request: ${url}`);
    });

    render(<UsersScreen />);

    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.queryByLabelText("alice × Family")).not.toBeInTheDocument();
  });

  it("calls the unlock endpoint", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/access-matrix") return MATRIX;
      if (url === "/api/admin/invites") return [];
      if (url === "/api/admin/users/bob/unlock" && init?.method === "POST") return { username: "bob" };
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    render(<UsersScreen />);
    await screen.findByText("bob");

    fireEvent.click(screen.getAllByRole("button", { name: "Unlock" })[1]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/users/bob/unlock", expect.objectContaining({ method: "POST" }));
    });
  });
});
