import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, noContentResponse } from "../testHelpers";
import SharingScreen from "./SharingScreen";

const USER_A = { id: 1, username: "alice", role: "admin", disabled: false, created_at: "2026-01-01" };
const USER_B = { id: 2, username: "bob", role: "user", disabled: false, created_at: "2026-01-01" };
const LIBRARY = { id: 10, display_name: "Family", path: "/libraries/Family.photoslibrary", created_at: "2026-01-01" };
const MATRIX = { users: [USER_A, USER_B], libraries: [LIBRARY], assignments: { "1": [10], "2": [] } };

function phone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SharingScreen", () => {
  it("renders the matrix with a labelled switch for every person and library", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/access-matrix") return MATRIX;
      throw new Error(`unexpected request: ${url}`);
    });
    render(<SharingScreen />);
    expect(await screen.findByRole("heading", { name: "Sharing", level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: "alice can see Family" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "bob can see Family" })).not.toBeChecked();
    expect(screen.getByRole("columnheader", { name: "Family" })).toBeInTheDocument();
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shares a library the moment its switch is turned on", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/access-matrix") return MATRIX;
      if (url === "/api/admin/users/2/libraries/10" && init?.method === "PUT") return noContentResponse();
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });
    render(<SharingScreen />);
    fireEvent.click(await screen.findByRole("switch", { name: "bob can see Family" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/users/2/libraries/10", expect.objectContaining({ method: "PUT" })),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before removing access and names the person and library", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/access-matrix") return MATRIX;
      if (url === "/api/admin/users/1/libraries/10" && init?.method === "DELETE") return noContentResponse();
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });
    render(<SharingScreen />);
    fireEvent.click(await screen.findByRole("switch", { name: "alice can see Family" }));
    const dialog = await screen.findByRole("dialog", { name: 'Stop sharing "Family" with alice?' });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/libraries/10"), expect.anything());
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop Sharing" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/users/1/libraries/10", expect.objectContaining({ method: "DELETE" })),
    );
  });

  it("leaves access alone when the removal is cancelled", async () => {
    const fetchMock = mockFetch((url) => {
      if (url === "/api/admin/access-matrix") return MATRIX;
      throw new Error(`unexpected request: ${url}`);
    });
    render(<SharingScreen />);
    fireEvent.click(await screen.findByRole("switch", { name: "alice can see Family" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clears a stale error once a later change succeeds", async () => {
    let calls = 0;
    mockFetch((url, init) => {
      if (url === "/api/admin/access-matrix") return MATRIX;
      if (url === "/api/admin/users/2/libraries/10" && init?.method === "PUT") {
        calls += 1;
        return calls === 1 ? jsonResponse({ detail: "nope" }, 400) : noContentResponse();
      }
      throw new Error(`unexpected request: ${url}`);
    });
    render(<SharingScreen />);
    fireEvent.click(await screen.findByRole("switch", { name: "bob can see Family" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    fireEvent.click(screen.getByRole("switch", { name: "bob can see Family" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("warns when no one can see a library", async () => {
    mockFetch(() => ({ ...MATRIX, assignments: { "1": [], "2": [] } }));
    render(<SharingScreen />);
    expect(await screen.findByText("No one can see Family now.")).toBeInTheDocument();
  });

  it("empty states: no libraries, and only administrators", async () => {
    mockFetch(() => ({ users: [USER_A], libraries: [], assignments: {} }));
    const first = render(<SharingScreen />);
    expect(await screen.findByText("Add a library first.")).toBeInTheDocument();
    first.unmount();
    mockFetch(() => ({ users: [USER_A], libraries: [LIBRARY], assignments: { "1": [10] } }));
    render(<SharingScreen />);
    expect(await screen.findByText(/Only administrators exist/)).toBeInTheDocument();
  });

  it("on a phone shows a list per person instead of the table", async () => {
    phone(true);
    mockFetch(() => MATRIX);
    render(<SharingScreen />);
    expect(await screen.findByRole("switch", { name: "bob can see Family" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "alice · Administrator" })).toBeInTheDocument();
  });
});
