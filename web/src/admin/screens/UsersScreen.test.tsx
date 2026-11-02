import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, noContentResponse } from "../testHelpers";
import UsersScreen from "./UsersScreen";

const USER_A = { id: 1, username: "alice", role: "admin", disabled: false, created_at: "2026-01-01" };
const USER_B = { id: 2, username: "bob", role: "user", disabled: false, created_at: "2026-01-01" };
const LIBRARY = { id: 10, display_name: "Family", path: "/libraries/Family.photoslibrary", created_at: "2026-01-01" };
const MATRIX = { users: [USER_A, USER_B], libraries: [LIBRARY], assignments: { "1": [10], "2": [] } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UsersScreen", () => {
  it("renders users and the access matrix", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/access-matrix") return MATRIX;
      if (url === "/api/admin/invites") return [];
      throw new Error(`unexpected request: ${url}`);
    });

    render(<UsersScreen />);

    expect(await screen.findByLabelText("alice × Family")).toBeInTheDocument();
    expect(screen.getAllByText("alice")).toHaveLength(2);
    expect(screen.getAllByText("bob")).toHaveLength(2);
    expect(screen.getByLabelText("alice × Family")).toBeChecked();
    expect(screen.getByLabelText("bob × Family")).not.toBeChecked();
  });

  it("assigns a library when its checkbox is toggled", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/access-matrix") return MATRIX;
      if (url === "/api/admin/invites") return [];
      if (url === "/api/admin/users/2/libraries/10" && init?.method === "PUT") return noContentResponse();
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    render(<UsersScreen />);
    await screen.findByLabelText("bob × Family");

    fireEvent.click(screen.getByLabelText("bob × Family"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/users/2/libraries/10", expect.objectContaining({ method: "PUT" }));
    });
  });

  it("calls the unlock endpoint", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/access-matrix") return MATRIX;
      if (url === "/api/admin/invites") return [];
      if (url === "/api/admin/users/bob/unlock" && init?.method === "POST") return { username: "bob" };
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    render(<UsersScreen />);
    await screen.findByLabelText("bob × Family");

    fireEvent.click(screen.getAllByRole("button", { name: "Unlock" })[1]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/users/bob/unlock", expect.objectContaining({ method: "POST" }));
    });
  });
});
