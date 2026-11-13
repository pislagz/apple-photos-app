import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, noContentResponse } from "../testHelpers";
import LibrariesScreen from "./LibrariesScreen";
import { formatSize } from "./LibraryPicker";

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

describe("formatSize", () => {
  it("uses plain units", () => {
    expect(formatSize(412_000_000_000)).toBe("412 GB");
    expect(formatSize(1_500_000)).toBe("1.5 MB");
  });
});

describe("library picker", () => {
  it("lists packages with status, count and size, and adds one with a click", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/libraries" && (init?.method ?? "GET") === "GET") return [];
      if (url === "/api/admin/library-candidates") return { folders: [FOLDER], candidates: [FAMILY, READY] };
      if (url.startsWith("/api/admin/library-candidates/size")) return { path: "x", size_bytes: 412_000_000_000 };
      if (url === "/api/admin/libraries" && init?.method === "POST") return { id: 1 };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<LibrariesScreen />);
    const list = await screen.findByRole("list", { name: "Libraries found" });
    await waitFor(() => expect(within(list).getAllByText(/Ready · 20 photos · 412 GB/)).toHaveLength(1));
    expect(within(list).getByText("Already added")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Add Family.photoslibrary" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/libraries",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ path: FAMILY.path, display_name: null }) }),
      ),
    );
  });

  it("shows a plain empty state when no folder is set", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/libraries") return [];
      if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<LibrariesScreen />);
    expect(await screen.findByText("No libraries found. Add a folder that contains your Photos libraries.")).toBeInTheDocument();
  });

  it("keeps the typed path under Advanced", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/libraries") return [];
      if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<LibrariesScreen />);
    const summary = await screen.findByText("Advanced");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(summary.closest("details")).toContainElement(screen.getByLabelText("Path"));
  });

  it("asks before removing a folder, and does nothing when declined", async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/libraries") return [];
      if (url === "/api/admin/library-candidates") return { folders: [FOLDER], candidates: [] };
      if (url.startsWith("/api/admin/library-folders") && init?.method === "DELETE") return noContentResponse();
      throw new Error(`unexpected request: ${url}`);
    });
    render(<LibrariesScreen />);
    const button = await screen.findByRole("button", { name: "Remove folder /libraries" });
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("library-folders"), expect.anything());
    fireEvent.click(button);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/library-folders?path=%2Flibraries", expect.objectContaining({ method: "DELETE" })),
    );
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
