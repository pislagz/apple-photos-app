import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../testHelpers";
import ActivityScreen, { PAGE_SIZE } from "./ActivityScreen";

const entry = (id: number, over = {}) => ({
  id,
  occurred_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
  action: "add_library",
  actor: "pp",
  user_id: null,
  username: null,
  library_id: 3,
  library_display_name: "Family",
  asset_id: null,
  detail: "id=3 display_name='Family'",
  ...over,
});

const MATRIX = {
  users: [
    { id: 1, username: "pp", role: "admin" },
    { id: 2, username: "Anna", role: "user" },
  ],
  libraries: [{ id: 3, display_name: "Family" }],
  assignments: {},
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ActivityScreen", () => {
  it("shows sentences and relative times, not raw codes or timestamps", async () => {
    mockFetch((url) => (url === "/api/admin/access-matrix" ? MATRIX : { entries: [entry(1), entry(2, { action: "mystery.code" })] }));
    render(<ActivityScreen />);
    expect(await screen.findByText("pp added the library Family")).toBeInTheDocument();
    expect(screen.getAllByText("3 hours ago").length).toBe(2);
    expect(screen.getByText("pp: mystery code")).toBeInTheDocument();
    expect(screen.queryByText("add_library")).toBeNull();
    expect(screen.getByRole("link", { name: "Export as CSV" })).toHaveAttribute("href", "/api/admin/audit-log.csv");
  });

  it("filters by names, using ids behind the scenes", async () => {
    const fetchMock = mockFetch((url) => (url === "/api/admin/access-matrix" ? MATRIX : { entries: [] }));
    render(<ActivityScreen />);
    const person = await screen.findByRole("combobox", { name: "Person" });
    await screen.findByRole("option", { name: "Anna" });
    fireEvent.change(person, { target: { value: "2" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("user_id=2"), expect.anything()));
    fireEvent.change(screen.getByRole("combobox", { name: "Library" }), { target: { value: "3" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("library_id=3"), expect.anything()));
    expect(await screen.findByText("Nothing matches these filters.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Export as CSV" }).getAttribute("href")).toContain("user_id=2");
    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    expect(await screen.findByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("loads more with an offset until a short page comes back", async () => {
    const first = Array.from({ length: PAGE_SIZE }, (_, i) => entry(100 - i));
    const fetchMock = mockFetch((url) => {
      if (url === "/api/admin/access-matrix") return MATRIX;
      if (url.includes(`offset=${PAGE_SIZE}`)) return { entries: [entry(1, { action: "remove_library" })] };
      return { entries: first };
    });
    render(<ActivityScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("pp removed the library Family")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`offset=${PAGE_SIZE}`), expect.anything());
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
