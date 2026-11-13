import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, noContentResponse } from "../testHelpers";
import LibrariesScreen, { IndexState } from "./LibrariesScreen";

const LIBRARY = { id: 1, display_name: "Family", path: "/libraries/Family.photoslibrary", created_at: "2026-01-01" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IndexState (#252)", () => {
  const base = { id: 1, display_name: "Family", path: "/l", asset_count: 1200, video_count: 0, people_count: 0, total_size_bytes: 1, prewarm_progress: null, warnings: [] };

  it("shows N of M photos and a bar while indexing", () => {
    render(<IndexState status={{ ...base, last_indexed_at: null, index_state: "indexing", index_progress: { done: 300, total: 1200 } }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Indexing… 300 of 1,200 photos");
    const bar = screen.getByRole("progressbar", { name: "Indexing progress" });
    expect(bar).toHaveAttribute("value", "300");
    expect(bar).toHaveAttribute("max", "1200");
  });

  it("shows Ready with the count once done, and errors in plain words", () => {
    const { rerender } = render(<IndexState status={{ ...base, last_indexed_at: "2026-11-11", index_state: "idle" }} />);
    expect(screen.getByText("Ready — 1,200 photos")).toBeInTheDocument();
    rerender(<IndexState status={{ ...base, last_indexed_at: null, index_state: "error", index_error: "disk gone" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Indexing failed: disk gone.");
  });

  it("loads every row's status without a button and polls until indexing ends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    mockFetch((url) => {
      if (url === "/api/admin/libraries") return [{ id: 1, display_name: "Family", path: "/l" }];
      if (url === "/api/admin/libraries/1/status") {
        calls += 1;
        return calls < 3
          ? { ...base, last_indexed_at: null, index_state: "indexing", index_progress: { done: calls * 100, total: 1200 } }
          : { ...base, last_indexed_at: "2026-11-11", index_state: "idle" };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    try {
      render(<LibrariesScreen />);
      expect(await screen.findByText("Indexing… 100 of 1,200 photos")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Load status" })).toBeNull();
      await vi.advanceTimersByTimeAsync(2000);
      expect(await screen.findByText("Indexing… 200 of 1,200 photos")).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(2000);
      expect(await screen.findByText("Ready — 1,200 photos")).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(6000);
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
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
    expect(await screen.findByRole("button", { name: "Replace with Family 2.photoslibrary" })).toBeInTheDocument();
    const others = screen.getByRole("list", { name: "Other candidates" });
    fireEvent.click(within(others).getByRole("button", { name: "Replace with Zed.photoslibrary" }));
    expect(await screen.findByDisplayValue("/libraries/Zed.photoslibrary")).toBeInTheDocument();
  });
});
