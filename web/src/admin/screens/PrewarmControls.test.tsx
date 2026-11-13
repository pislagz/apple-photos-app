import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "../testHelpers";
import { GroupedList } from "../ui/GroupedList";
import PrewarmControls from "./PrewarmControls";

const base = { total: 10, done: 4, failed: 0, note: null };

function renderControls(props: React.ComponentProps<typeof PrewarmControls>) {
  return render(
    <GroupedList>
      <PrewarmControls {...props} />
    </GroupedList>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PrewarmControls", () => {
  it("offers Prepare when nothing has run and posts to start", async () => {
    const fetchMock = mockFetch((url) => {
      if (url === "/api/admin/libraries/1/prewarm/start") return { ...base, state: "running", done: 0 };
      throw new Error(`unexpected ${url}`);
    });
    renderControls({ libraryId: 1, initial: { ...base, state: "idle", total: 0, done: 0 } });
    expect(screen.getByText("Not prepared yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prepare Thumbnails" }));
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/libraries/1/prewarm/start", expect.objectContaining({ method: "POST" }));
  });

  it("shows progress while running and pauses", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/libraries/1/prewarm/pause") return { ...base, state: "paused" };
      throw new Error(`unexpected ${url}`);
    });
    renderControls({ libraryId: 1, initial: { ...base, state: "running" } });
    expect(screen.getByText(/Preparing 4 of 10 \(40%\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Thumbnail progress")).toHaveAttribute("value", "40");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(await screen.findByText(/Paused at 4 of 10/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("shows the cache-full note", () => {
    renderControls({ libraryId: 1, initial: { ...base, state: "paused", note: "Thumbnail cache is nearly full." } });
    expect(screen.getByText(/nearly full/)).toBeInTheDocument();
  });

  it("deletes the cache only after confirming in the sheet, then resets to idle", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const fetchMock = mockFetch((url) => {
      if (url === "/api/admin/libraries/1/thumbnail-cache/clear")
        return { freed_bytes: 2_000_000, status: { ...base, state: "idle", total: 0, done: 0 } };
      throw new Error(`unexpected ${url}`);
    });
    renderControls({ libraryId: 1, initial: { ...base, state: "done" }, cacheBytes: 1_200_000_000 });
    fireEvent.click(screen.getByRole("button", { name: "Delete Cache…" }));
    expect(fetchMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete thumbnail cache?" });
    expect(dialog).toHaveTextContent("This frees about 1.2 GB.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete Cache" }));
    expect(await screen.findByText("Deleted 2 MB of thumbnails.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare Thumbnails" })).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does nothing when the sheet is cancelled", async () => {
    const fetchMock = mockFetch(() => {
      throw new Error("should not call");
    });
    renderControls({ libraryId: 1, initial: { ...base, state: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete Cache…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it("gives every action an (i)", () => {
    renderControls({ libraryId: 1, initial: null });
    expect(screen.getByRole("button", { name: "About thumbnails" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About thumbnail cache" })).toBeInTheDocument();
  });

  it("shows an error from the server", async () => {
    mockFetch(() => jsonResponse({ detail: "The thumbnail cache is turned off." }, 400));
    renderControls({ libraryId: 1, initial: null });
    fireEvent.click(screen.getByRole("button", { name: "Prepare Thumbnails" }));
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
      renderControls({ libraryId: 1, initial: { ...base, state: "running" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText(/Couldn't refresh progress/)).toBeInTheDocument();
      fail = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.queryByText(/Couldn't refresh progress/)).not.toBeInTheDocument();
      expect(screen.getByText(/Preparing 6 of 10/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
