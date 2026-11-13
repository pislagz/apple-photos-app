import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, noContentResponse } from "../testHelpers";
import LibrariesScreen from "./LibrariesScreen";

const LIBRARY = { id: 1, display_name: "Family", path: "/libraries/Family.photoslibrary", created_at: "2026-01-01 10:00:00" };

const BASE = {
  id: 1,
  display_name: "Family",
  path: LIBRARY.path,
  asset_count: 20,
  video_count: 2,
  people_count: 3,
  total_size_bytes: 412_000_000_000,
  last_indexed_at: "2026-11-11 09:14:03",
  index_state: "idle",
  prewarm_progress: null,
  warnings: [],
};

const RUN = {
  id: 7,
  trigger: "auto",
  started_at: "2026-11-03T14:20:00Z",
  finished_at: "2026-11-03T14:21:00Z",
  outcome: "applied",
  asset_count: 100,
  added: 12,
  removed: 3,
  changed: 1,
  hidden_changed: 0,
  originals_missing: 0,
  originals_missing_pct: 0,
  error: null,
  summary: "Updated 2026-11-03 14:21:00: 12 added, 3 removed, 1 changed",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function api(status: object | ((url: string) => unknown) = BASE, extra: Record<string, unknown> = {}) {
  return mockFetch((url, init) => {
    if (url === "/api/admin/libraries" && (init?.method ?? "GET") === "GET") return [LIBRARY];
    if (url === "/api/admin/libraries/1/status") return typeof status === "function" ? status(url) : status;
    if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
    if (url in extra) return extra[url];
    throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
  });
}

function openDetail() {
  render(<LibrariesScreen selected="1" onSelect={vi.fn()} />);
}

describe("Libraries list", () => {
  it("shows status, count and size in words, loads status by itself and hides paths and raw dates", async () => {
    api();
    const { container } = render(<LibrariesScreen />);
    const list = await screen.findByRole("list", { name: "Libraries" });
    expect(await within(list).findByText("Ready · 20 photos · 412 GB")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load status" })).toBeNull();
    const text = container.textContent ?? "";
    expect(text).not.toContain("/libraries");
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/\d{9,}/);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("ul, ol")).toBeNull();
  });

  it("opens the detail page when a row is chosen", async () => {
    api();
    const onSelect = vi.fn();
    render(<LibrariesScreen onSelect={onSelect} selected={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /Family/ }));
    expect(onSelect).toHaveBeenCalledWith("1");
  });

  it("uses the plain status words", async () => {
    api({ ...BASE, warnings: [{ code: "drive_not_mounted", message: "/Volumes/x is not mounted" }] });
    render(<LibrariesScreen />);
    expect(await screen.findByText(/^Not found/)).toBeInTheDocument();
  });

  it("shows a friendly empty state with help to connect a folder", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/libraries") return [];
      if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<LibrariesScreen />);
    expect(await screen.findByText("No libraries yet")).toBeInTheDocument();
    expect(screen.getByText("How do I connect a folder?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Library…" }));
    expect(await screen.findByRole("dialog", { name: "Add Library" })).toBeInTheDocument();
  });

  it("every action on the list has an (i)", async () => {
    api();
    render(<LibrariesScreen />);
    await screen.findByRole("list", { name: "Libraries" });
    expect(screen.getByRole("button", { name: "About adding a library" })).toBeInTheDocument();
  });
});

describe("Indexing progress (#252)", () => {
  it("shows N of M and a bar on the row, with no Load status button, and polls until done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    mockFetch((url) => {
      if (url === "/api/admin/libraries") return [LIBRARY];
      if (url === "/api/admin/libraries/1/status") {
        calls += 1;
        return calls < 3
          ? { ...BASE, asset_count: null, last_indexed_at: null, index_state: "indexing", index_progress: { done: calls * 100, total: 1200 } }
          : { ...BASE, asset_count: 1200 };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    render(<LibrariesScreen />);
    expect(await screen.findByText("Reading photos… · 100 of 1,200 photos")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Indexing progress" });
    expect(bar).toHaveAttribute("value", "100");
    expect(bar).toHaveAttribute("max", "1200");
    expect(screen.queryByRole("button", { name: "Load status" })).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByText("Reading photos… · 200 of 1,200 photos")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByText("Ready · 1,200 photos · 412 GB")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(6000);
    expect(calls).toBe(3);
  });

  it("says in plain words when reading failed", async () => {
    api({ ...BASE, last_indexed_at: null, index_state: "error", index_error: "disk gone" });
    openDetail();
    expect(await screen.findByRole("alert")).toHaveTextContent("Reading this library failed: disk gone.");
  });
});

describe("Library page", () => {
  it("shows the facts in words, with no raw dates, sizes or full path", async () => {
    api();
    openDetail();
    const photos = await screen.findByText("Photos");
    expect(photos.closest('[role="listitem"]')).toHaveTextContent("20");
    expect(screen.getByText("Size on disk").closest('[role="listitem"]')).toHaveTextContent("412 GB");
    expect(screen.getByText("Family.photoslibrary")).toBeInTheDocument();
    const page = document.body.textContent ?? "";
    expect(page).not.toContain("/libraries/");
    expect(page).not.toMatch(/\d{4}-\d{2}-\d{2}T?/);
    expect(page).not.toContain("412000000000");
  });

  it("gives every action an (i)", async () => {
    api();
    openDetail();
    await screen.findByText("Size on disk");
    for (const name of ["rename", "check for changes", "replace library file", "thumbnails", "thumbnail cache", "remove library"]) {
      expect(screen.getByRole("button", { name: `About ${name}` })).toBeInTheDocument();
    }
  });

  it("renames inline, without window.prompt", async () => {
    const prompt = vi.fn();
    vi.stubGlobal("prompt", prompt);
    const fetchMock = api(BASE, { "/api/admin/libraries/1": { ...LIBRARY, display_name: "Our family" } });
    openDetail();
    await screen.findByText("Size on disk");
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Our family" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/libraries/1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ display_name: "Our family" }) })),
    );
    expect(prompt).not.toHaveBeenCalled();
  });

  it("removes a library only after confirming in the sheet", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const onSelect = vi.fn();
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/libraries" && (init?.method ?? "GET") === "GET") return [LIBRARY];
      if (url === "/api/admin/libraries/1/status") return BASE;
      if (url === "/api/admin/libraries/1" && init?.method === "DELETE") return noContentResponse();
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });
    render(<LibrariesScreen selected="1" onSelect={onSelect} />);
    await screen.findByText("Size on disk");

    fireEvent.click(screen.getByRole("button", { name: "Remove…" }));
    const sheet = screen.getByRole("dialog", { name: "Remove “Family”?" });
    expect(sheet).toHaveTextContent("Your photos and the library file are not deleted.");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/admin/libraries/1", expect.objectContaining({ method: "DELETE" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Remove Library" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/libraries/1", expect.objectContaining({ method: "DELETE" })));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does not remove when the sheet is cancelled", async () => {
    const fetchMock = api();
    openDetail();
    await screen.findByText("Size on disk");
    fireEvent.click(screen.getByRole("button", { name: "Remove…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/admin/libraries/1", expect.objectContaining({ method: "DELETE" }));
  });

  it("checks for changes now", async () => {
    const fetchMock = api(BASE, { "/api/admin/libraries/1/reindex": { ...BASE, asset_count: 21 } });
    openDetail();
    await screen.findByText("Size on disk");
    fireEvent.click(screen.getByRole("button", { name: "Check Now" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/libraries/1/reindex", expect.objectContaining({ method: "POST" })));
  });

  it("shows the last updates in plain words, at most ten, with no raw timestamps", async () => {
    api({ ...BASE, last_update: RUN, runs: Array.from({ length: 12 }, (_, i) => ({ ...RUN, id: 100 - i, added: i + 1 })) });
    openDetail();
    await screen.findByText("Size on disk");
    expect(screen.queryByRole("list", { name: "Update history" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    const history = screen.getByRole("list", { name: "Update history" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(10);
    expect(within(history).getAllByText(/Updated\. 1 added, 3 removed, 1 changed\./)).toHaveLength(1);
    expect(history.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(history.textContent).toContain("Checked automatically");
  });

  it("offers the suggested file first and the other candidates to pick from", async () => {
    const STATUS = {
      ...BASE,
      warnings: [{ code: "drive_not_mounted", message: "x" }],
      suggestion: { path: "/libraries/Family 2.photoslibrary", name: "Family 2.photoslibrary", message: "A new library appeared next to this one: Family 2.photoslibrary. Replace?" },
      alternatives: [{ path: "/libraries/Zed.photoslibrary", name: "Zed.photoslibrary", message: "x" }],
    };
    api(STATUS);
    openDetail();
    expect(await screen.findByRole("button", { name: "Replace with Family 2.photoslibrary" })).toBeInTheDocument();
    const others = screen.getByRole("list", { name: "Other candidates" });
    expect(within(others).getByRole("button", { name: "Replace with Zed.photoslibrary" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The drive with this library isn't connected");
  });
});
