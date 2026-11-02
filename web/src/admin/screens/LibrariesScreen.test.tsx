import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, noContentResponse } from "../testHelpers";
import LibrariesScreen from "./LibrariesScreen";

const LIBRARY = { id: 1, display_name: "Family", path: "/libraries/Family.photoslibrary", created_at: "2026-01-01" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LibrariesScreen", () => {
  it("lists libraries from the API", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/libraries") return [LIBRARY];
      throw new Error(`unexpected request: ${url}`);
    });

    render(<LibrariesScreen />);

    expect(await screen.findByText("Family")).toBeInTheDocument();
    expect(screen.getByText("/libraries/Family.photoslibrary")).toBeInTheDocument();
  });

  it("removes a library after confirming", async () => {
    vi.stubGlobal("confirm", () => true);
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/libraries" && (init?.method ?? "GET") === "GET") return [LIBRARY];
      if (url === "/api/admin/libraries/1" && init?.method === "DELETE") return noContentResponse();
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    render(<LibrariesScreen />);
    await screen.findByText("Family");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/libraries/1", expect.objectContaining({ method: "DELETE" }));
    });
  });
});
