import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "../testHelpers";
import PrewarmControls from "./PrewarmControls";

const base = { total: 10, done: 4, failed: 0, note: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PrewarmControls", () => {
  it("offers Start when nothing has run and posts to start", async () => {
    const fetchMock = mockFetch((url) => {
      if (url === "/api/admin/libraries/1/prewarm/start") return { ...base, state: "running", done: 0 };
      throw new Error(`unexpected ${url}`);
    });
    render(<PrewarmControls libraryId={1} initial={{ ...base, state: "idle", total: 0, done: 0 }} />);
    expect(screen.getByText("Thumbnails: not pre-generated")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start pre-warm" }));
    expect(await screen.findByRole("button", { name: "Pause pre-warm" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/libraries/1/prewarm/start", expect.objectContaining({ method: "POST" }));
  });

  it("shows progress while running and pauses", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/libraries/1/prewarm/pause") return { ...base, state: "paused" };
      throw new Error(`unexpected ${url}`);
    });
    render(<PrewarmControls libraryId={1} initial={{ ...base, state: "running" }} />);
    expect(screen.getByText(/pre-generating 4 of 10 \(40%\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Pre-warm progress")).toHaveAttribute("value", "40");
    fireEvent.click(screen.getByRole("button", { name: "Pause pre-warm" }));
    expect(await screen.findByText(/paused at 4 of 10/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume pre-warm" })).toBeInTheDocument();
  });

  it("shows the cache-full note", () => {
    render(<PrewarmControls libraryId={1} initial={{ ...base, state: "paused", note: "Thumbnail cache is nearly full." }} />);
    expect(screen.getByText(/nearly full/)).toBeInTheDocument();
  });

  it("clears the cache only after confirming, then resets to idle", async () => {
    vi.stubGlobal("confirm", () => true);
    mockFetch((url) => {
      if (url === "/api/admin/libraries/1/thumbnail-cache/clear")
        return { freed_bytes: 2 * 1024 * 1024, status: { ...base, state: "idle", total: 0, done: 0 } };
      throw new Error(`unexpected ${url}`);
    });
    render(<PrewarmControls libraryId={1} initial={{ ...base, state: "done" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear thumbnail cache" }));
    expect(await screen.findByText("Cleared 2.0 MB of thumbnails.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start pre-warm" })).toBeInTheDocument();
  });

  it("does nothing when the confirm is declined", async () => {
    vi.stubGlobal("confirm", () => false);
    const fetchMock = mockFetch(() => {
      throw new Error("should not call");
    });
    render(<PrewarmControls libraryId={1} initial={{ ...base, state: "done" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear thumbnail cache" }));
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it("shows an error from the server", async () => {
    mockFetch(() => jsonResponse({ detail: "The thumbnail cache is turned off." }, 400));
    render(<PrewarmControls libraryId={1} initial={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Start pre-warm" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("says progress is not refreshing when polling fails, and recovers (#199)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let fail = true;
      mockFetch((url) => {
        if (url === "/api/admin/libraries/1/status") {
          return fail ? jsonResponse({ detail: "down" }, 500) : { prewarm: { ...base, state: "running", done: 6 } };
        }
        throw new Error(`unexpected ${url}`);
      });
      render(<PrewarmControls libraryId={1} initial={{ ...base, state: "running" }} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText(/Couldn't refresh progress/)).toBeInTheDocument();
      fail = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.queryByText(/Couldn't refresh progress/)).not.toBeInTheDocument();
      expect(screen.getByText(/pre-generating 6 of 10/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
