import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("prefills the best match and lists the other candidates to pick from", async () => {
    const STATUS = {
      id: 1,
      display_name: "Family",
      path: LIBRARY.path,
      asset_count: 1,
      video_count: 0,
      people_count: 0,
      total_size_bytes: 1,
      last_indexed_at: null,
      prewarm_progress: null,
      warnings: [],
      suggestion: { path: "/libraries/Family 2.photoslibrary", name: "Family 2.photoslibrary", message: "A new library appeared next to this one: Family 2.photoslibrary. Replace?" },
      alternatives: [{ path: "/libraries/Zed.photoslibrary", name: "Zed.photoslibrary", message: "x" }],
    };
    mockFetch((url) => {
      if (url === "/api/admin/libraries") return [LIBRARY];
      if (url === "/api/admin/libraries/1/status") return STATUS;
      throw new Error(`unexpected request: ${url}`);
    });
    render(<LibrariesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Load status" }));
    expect(await screen.findByRole("button", { name: "Replace with Family 2.photoslibrary" })).toBeInTheDocument();
    const others = screen.getByRole("list", { name: "Other candidates" });
    fireEvent.click(within(others).getByRole("button", { name: "Replace with Zed.photoslibrary" }));
    expect(await screen.findByDisplayValue("/libraries/Zed.photoslibrary")).toBeInTheDocument();
  });
});
