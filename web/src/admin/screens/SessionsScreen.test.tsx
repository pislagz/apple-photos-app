import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, noContentResponse } from "../testHelpers";
import SessionsScreen from "./SessionsScreen";

const SESSION = {
  id: "sess-1",
  username: "alice",
  device: "iPhone",
  created_at: "2026-01-01T00:00:00Z",
  last_seen_at: "2026-01-02T00:00:00Z",
  expires_at: "2026-02-01T00:00:00Z",
  remember_me: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SessionsScreen", () => {
  it("lists sessions", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/sessions") return [SESSION];
      throw new Error(`unexpected request: ${url}`);
    });

    render(<SessionsScreen />);

    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByText("iPhone")).toBeInTheDocument();
  });

  it("revokes a session after confirming", async () => {
    vi.stubGlobal("confirm", () => true);
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/sessions" && (init?.method ?? "GET") === "GET") return [SESSION];
      if (url === "/api/admin/sessions/sess-1" && init?.method === "DELETE") return noContentResponse();
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    render(<SessionsScreen />);
    await screen.findByText("alice");

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/sessions/sess-1", expect.objectContaining({ method: "DELETE" }));
    });
  });
});
