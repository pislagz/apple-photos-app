import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, noContentResponse } from "../testHelpers";
import AddLibrarySheet from "./AddLibrarySheet";

const FOLDER = { path: "/libraries", reachable: true };
const FAMILY = {
  name: "Family.photoslibrary",
  path: "/libraries/Family.photoslibrary",
  folder: "/libraries",
  registered: false,
  library_id: null,
  library_name: null,
  status: "not_added",
  asset_count: null,
  size_bytes: null,
};
const READY = { ...FAMILY, name: "Trips.photoslibrary", path: "/libraries/Trips.photoslibrary", registered: true, library_id: 2, library_name: "Trips", status: "ready", asset_count: 20 };

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSheet(onAdded = vi.fn()) {
  render(<AddLibrarySheet onClose={vi.fn()} onAdded={onAdded} />);
  return onAdded;
}

describe("library picker (Add Library)", () => {
  it("lists packages with status, count and size, and adds one in two steps", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/library-candidates") return { folders: [FOLDER], candidates: [FAMILY, READY] };
      if (url.startsWith("/api/admin/library-candidates/size")) return { path: "x", size_bytes: 412_000_000_000 };
      if (url === "/api/admin/libraries" && init?.method === "POST") return { id: 1 };
      throw new Error(`unexpected request: ${url}`);
    });
    const onAdded = renderSheet();
    const list = await screen.findByRole("list", { name: "Libraries found" });
    await waitFor(() => expect(within(list).getAllByText(/Ready · 20 photos · 412 GB/)).toHaveLength(1));
    expect(within(list).getByText("Already added")).toBeInTheDocument();
    expect(within(list).queryByText(/\/libraries\//)).toBeNull();

    fireEvent.click(within(list).getByRole("button", { name: "Add Family.photoslibrary" }));
    // Step 2: the name is prefilled from the package.
    expect(screen.getByLabelText("Name")).toHaveValue("Family");
    fireEvent.click(screen.getByRole("button", { name: "Add Library" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/libraries",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ path: FAMILY.path, display_name: null }) }),
      ),
    );
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith({ id: 1 }));
  });

  it("sends an edited name", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/library-candidates") return { folders: [FOLDER], candidates: [FAMILY] };
      if (url.startsWith("/api/admin/library-candidates/size")) return { path: "x", size_bytes: 1 };
      if (url === "/api/admin/libraries" && init?.method === "POST") return { id: 1 };
      throw new Error(`unexpected request: ${url}`);
    });
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: "Add Family.photoslibrary" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Our family" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Library" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/libraries",
        expect.objectContaining({ body: JSON.stringify({ path: FAMILY.path, display_name: "Our family" }) }),
      ),
    );
  });

  it("shows a plain empty state with help when no folder is set", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
      throw new Error(`unexpected request: ${url}`);
    });
    renderSheet();
    expect(await screen.findByText("No libraries found. Add a folder that contains your Photos libraries.")).toBeInTheDocument();
    expect(screen.getByText("How do I connect a folder?")).toBeInTheDocument();
  });

  it("keeps the typed path under Advanced", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
      if (url === "/api/admin/libraries" && init?.method === "POST") return { id: 3 };
      throw new Error(`unexpected request: ${url}`);
    });
    renderSheet();
    const summary = await screen.findByText("Advanced");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(summary.closest("details")).toContainElement(screen.getByLabelText("Path"));
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "/x/Y.photoslibrary" } });
    fireEvent.click(screen.getByRole("button", { name: "Add by Path" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/libraries",
        expect.objectContaining({ body: JSON.stringify({ path: "/x/Y.photoslibrary", display_name: null }) }),
      ),
    );
  });

  it("adds a folder", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
      if (url === "/api/admin/library-folders" && init?.method === "POST") return [FOLDER];
      throw new Error(`unexpected request: ${url}`);
    });
    renderSheet();
    fireEvent.change(await screen.findByLabelText("Add a folder"), { target: { value: "/libraries" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Folder" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/library-folders", expect.objectContaining({ method: "POST" })),
    );
  });

  it("asks in a sheet before removing a folder, and does nothing when cancelled", async () => {
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/library-candidates") return { folders: [FOLDER], candidates: [] };
      if (url.startsWith("/api/admin/library-folders") && init?.method === "DELETE") return noContentResponse();
      throw new Error(`unexpected request: ${url}`);
    });
    renderSheet();
    const button = await screen.findByRole("button", { name: "Remove folder /libraries" });
    fireEvent.click(button);
    const sheet = screen.getByRole("dialog", { name: "Stop looking in this folder?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("library-folders"), expect.anything());
    fireEvent.click(button);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Stop looking in this folder?" })).getByRole("button", { name: "Remove Folder" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/library-folders?path=%2Flibraries", expect.objectContaining({ method: "DELETE" })),
    );
    expect(confirm).not.toHaveBeenCalled();
  });
});
