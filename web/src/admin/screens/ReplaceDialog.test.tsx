import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../testHelpers";
import LibrariesScreen from "./LibrariesScreen";

const LIBRARY = { id: 1, display_name: "Family", path: "/libraries/Family.photoslibrary", created_at: "2026-01-01" };

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
  summary: "Updated 3 Nov 14:20: 12 added, 3 removed, 1 changed",
};

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
  last_update: RUN,
  runs: Array.from({ length: 12 }, (_, i) => ({ ...RUN, id: 100 - i, summary: `run ${i}` })),
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

afterEach(() => {
  vi.unstubAllGlobals();
});

function replaceBodies(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/admin/libraries/1/replace")
    .map(([, init]) => JSON.parse(String(init!.body)));
}

describe("Libraries: run history and suggestion", () => {
  it("shows the last update and at most ten history entries", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/libraries") return [LIBRARY];
      if (url === "/api/admin/libraries/1/status") return STATUS;
      throw new Error(`unexpected request: ${url}`);
    });
    render(<LibrariesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Load status" }));

    expect(await screen.findByText("Updated 3 Nov 14:20: 12 added, 3 removed, 1 changed")).toBeInTheDocument();
    const history = screen.getByRole("list", { name: "Update history" });
    expect(history.querySelectorAll("li")).toHaveLength(10);
  });

  it("offers the suggested package as a prefilled Replace", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/libraries") return [LIBRARY];
      if (url === "/api/admin/libraries/1/status") {
        return {
          ...STATUS,
          suggestion: {
            path: "/libraries/Family 2026.photoslibrary",
            name: "Family 2026.photoslibrary",
            message: "A new library appeared next to this one: Family 2026.photoslibrary. Replace?",
          },
        };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    render(<LibrariesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Load status" }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace with Family 2026.photoslibrary" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("New path")).toHaveValue("/libraries/Family 2026.photoslibrary");
  });
});

describe("Replace library file dialog", () => {
  async function openDialog() {
    render(<LibrariesScreen />);
    await screen.findByText("Family");
    fireEvent.click(screen.getByRole("button", { name: "Replace library file" }));
    fireEvent.change(screen.getByLabelText("New path"), { target: { value: PREVIEW.path } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  }

  it("previews, then confirms without an override when there are no warnings", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/libraries") return [LIBRARY];
      if (url === "/api/admin/libraries/1/status") return STATUS;
      if (url === "/api/admin/libraries/1/replace") {
        return JSON.parse(String(init!.body)).confirm ? { ...PREVIEW, confirmed: true } : PREVIEW;
      }
      throw new Error(`unexpected request: ${url}`);
    });
    await openDialog();

    expect(await screen.findByText("12 would be added")).toBeInTheDocument();
    expect(screen.getByText("2 would be removed")).toBeInTheDocument();
    expect(screen.getByText("98% of the current photos are in the new file")).toBeInTheDocument();
    expect(screen.queryByLabelText("Replace anyway")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(replaceBodies(fetchMock)).toEqual([
      { path: PREVIEW.path, confirm: false, replace_anyway: false },
      { path: PREVIEW.path, confirm: true, replace_anyway: false },
    ]);
  });

  it("requires the Replace anyway checkbox when the preview has warnings", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/libraries") return [LIBRARY];
      if (url === "/api/admin/libraries/1/status") return STATUS;
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
      throw new Error(`unexpected request: ${url}`);
    });
    await openDialog();

    expect(await screen.findByText("This looks like a different library.")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Replace anyway" });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Replace anyway"));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(replaceBodies(fetchMock)).toHaveLength(2));
    expect(replaceBodies(fetchMock)[1]).toEqual({ path: PREVIEW.path, confirm: true, replace_anyway: true });
  });

  it("shows the server's refusal and keeps the dialog open", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/libraries") return [LIBRARY];
      if (url === "/api/admin/libraries/1/replace") {
        return new Response(JSON.stringify({ detail: "this path is already registered as another library" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    await openDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("already registered");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
