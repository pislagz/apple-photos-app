import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../testHelpers";
import LibrariesScreen from "./LibrariesScreen";

const LIBRARY = { id: 1, display_name: "Family", path: "/libraries/Family.photoslibrary", created_at: "2026-01-01" };

const STATUS = {
  ...LIBRARY,
  asset_count: 100,
  video_count: 2,
  people_count: 0,
  total_size_bytes: 1,
  last_indexed_at: "2026-11-03",
  prewarm_progress: null,
  warnings: [],
  updating: false,
  runs: [],
  suggestion: null,
};

const PREVIEW = {
  path: "/libraries/Family 2026.photoslibrary",
  confirmed: false,
  new_asset_count: 110,
  would_add: 12,
  would_remove: 2,
  overlap: 0.98,
  store_uuid_match: true,
  originals_missing: 0,
  originals_missing_pct: 0,
  warnings: [],
  status: null,
};

const SUGGESTION = {
  path: "/libraries/Family 2026.photoslibrary",
  name: "Family 2026.photoslibrary",
  message: "A new library appeared next to this one: Family 2026.photoslibrary. Replace?",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function replaceBodies(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/admin/libraries/1/replace")
    .map(([, init]) => JSON.parse(String(init!.body)));
}

function baseRoutes(url: string) {
  if (url === "/api/admin/libraries") return [LIBRARY];
  if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
  if (url === "/api/admin/libraries/1/status") return STATUS;
  throw new Error(`unexpected request: ${url}`);
}

describe("Replace library file", () => {
  async function openDialog() {
    render(<LibrariesScreen selected="1" onSelect={vi.fn()} />);
    await screen.findByText("Size on disk");
    fireEvent.click(screen.getByRole("button", { name: "Replace…" }));
  }

  async function chooseTyped(path: string) {
    fireEvent.click(await screen.findByText("Advanced"));
    fireEvent.change(screen.getByLabelText("New path"), { target: { value: path } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  }

  it("offers the suggestion on the page and previews it straight away", async () => {
    const fetchMock = mockFetch((url) => {
      if (url === "/api/admin/libraries/1/status") return { ...STATUS, suggestion: SUGGESTION };
      if (url === "/api/admin/libraries/1/replace") return PREVIEW;
      return baseRoutes(url);
    });
    render(<LibrariesScreen selected="1" onSelect={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Replace with Family 2026.photoslibrary" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Will be added")).toBeInTheDocument();
    expect(replaceBodies(fetchMock)).toEqual([{ path: SUGGESTION.path, confirm: false, replace_anyway: false }]);
  });

  it("pins the suggestion at the top of the picker when Replace… is chosen", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/libraries/1/status") return { ...STATUS, suggestion: SUGGESTION };
      return baseRoutes(url);
    });
    await openDialog();
    const suggested = await screen.findByRole("list", { name: "Suggested libraries" });
    expect(within(suggested).getByRole("button", { name: "Choose Family 2026.photoslibrary" })).toBeInTheDocument();
  });

  it("previews, then confirms without an override when there are no warnings", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/libraries/1/replace") {
        return JSON.parse(String(init!.body)).confirm ? { ...PREVIEW, confirmed: true } : PREVIEW;
      }
      return baseRoutes(url);
    });
    await openDialog();
    await chooseTyped(PREVIEW.path);

    const dialog = await screen.findByRole("dialog", { name: "Replace “Family” with “Family 2026”?" });
    const preview = await within(dialog).findByRole("list", { name: "Replace preview" });
    expect(within(preview).getByText("Will be added").closest('[role="listitem"]')).toHaveTextContent("12");
    expect(within(preview).getByText("Will be removed").closest('[role="listitem"]')).toHaveTextContent("2");
    expect(preview).toHaveTextContent("98%");
    expect(preview).toHaveTextContent("Yes");
    expect(screen.queryByRole("button", { name: "Replace Anyway" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(replaceBodies(fetchMock)).toEqual([
      { path: PREVIEW.path, confirm: false, replace_anyway: false },
      { path: PREVIEW.path, confirm: true, replace_anyway: false },
    ]);
  });

  it("turns the confirm into a red Replace Anyway when the preview has warnings", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/libraries/1/replace") {
        const body = JSON.parse(String(init!.body));
        return body.confirm
          ? { ...PREVIEW, confirmed: true }
          : {
              ...PREVIEW,
              overlap: 0,
              store_uuid_match: false,
              warnings: [
                { code: "low_overlap", message: "Only 0% of the current photos are in the new file." },
                { code: "store_uuid_differs", message: "This looks like a different library." },
              ],
            };
      }
      return baseRoutes(url);
    });
    await openDialog();
    await chooseTyped(PREVIEW.path);

    expect(await screen.findByText("This looks like a different library.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Replace anyway")).not.toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Replace Anyway" });
    expect(confirm).toHaveClass("admin-btn--danger-fill");
    fireEvent.click(confirm);

    await waitFor(() => expect(replaceBodies(fetchMock)).toHaveLength(2));
    expect(replaceBodies(fetchMock)[1]).toEqual({ path: PREVIEW.path, confirm: true, replace_anyway: true });
  });

  it("drops the preview and the override when another file is chosen", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/libraries/1/replace") {
        return { ...PREVIEW, warnings: [{ code: "low_overlap", message: "Only 0% of the current photos are in the new file." }] };
      }
      return baseRoutes(url);
    });
    await openDialog();
    await chooseTyped(PREVIEW.path);
    await screen.findByRole("button", { name: "Replace Anyway" });

    fireEvent.click(screen.getByRole("button", { name: "Choose a Different File" }));
    expect(screen.queryByRole("list", { name: "Replace preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Replace( Anyway)?$/ })).not.toBeInTheDocument();
    expect(await screen.findByLabelText("New path")).toBeInTheDocument();
  });

  it("shows the server's refusal and keeps the dialog open", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/libraries/1/replace") {
        return new Response(JSON.stringify({ detail: "this path is already registered as another library" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      return baseRoutes(url);
    });
    await openDialog();
    await chooseTyped(PREVIEW.path);

    expect(await screen.findByRole("alert")).toHaveTextContent("already registered");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
