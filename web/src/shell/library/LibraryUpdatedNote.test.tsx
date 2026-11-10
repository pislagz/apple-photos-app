import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../../api";
import { jsonResponse, mockFetch } from "../../testHelpers";
import DesktopShell from "../DesktopShell";
import MobileShell from "../MobileShell";
import { LibraryNoteFrame, LibraryUpdatedNote, updatedNoteText } from "./LibraryUpdatedNote";

const NOTE = { run_id: 7, added: 1204, removed: 3, finished_at: "2026-11-09T10:00:00Z" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Library updated banner (D4)", () => {
  it("formats the counts", () => {
    expect(updatedNoteText(NOTE)).toBe("Library updated · +1,204 added, −3 removed");
  });

  it("dismisses once: posts the run id, hides, and tells the shell", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/libraries/1/updated-note/dismiss" && init?.method === "POST") return jsonResponse({ run_id: 7 });
      throw new Error(`unexpected request: ${url}`);
    });
    const onDismissed = vi.fn();
    render(<LibraryUpdatedNote libraryId={1} note={NOTE} variant="desktop" onDismissed={onDismissed} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss library update note" }));

    expect(screen.queryByTestId("library-updated-note")).toBeNull();
    await waitFor(() => expect(onDismissed).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({ run_id: 7 });
  });

  it("frame shows nothing without a note and keeps its children mounted when the note goes away", () => {
    const { rerender } = render(
      <LibraryNoteFrame libraryId={1} note={null} variant="mobile">
        <p>grid</p>
      </LibraryNoteFrame>,
    );
    expect(screen.queryByTestId("library-updated-note")).toBeNull();
    const grid = screen.getByText("grid");
    rerender(
      <LibraryNoteFrame libraryId={1} note={NOTE} variant="mobile">
        <p>grid</p>
      </LibraryNoteFrame>,
    );
    expect(screen.getByTestId("library-updated-note")).toHaveTextContent("+1,204 added");
    expect(screen.getByText("grid")).toBe(grid);
  });
});

const ME: MeResponse = {
  username: "alice",
  role: "user",
  libraries: [{ id: 1, display_name: "Family", updated_note: NOTE }],
  layout_override: null,
};
const common = {
  me: ME,
  activeLibraryId: 1,
  onActiveLibraryChange: () => {},
  layoutOverride: "auto" as const,
  onLayoutOverrideChange: () => {},
  onLogout: () => {},
};

function emptyLibraryFetch() {
  return mockFetch((url) => {
    if (url.includes("/summary")) return { years: [], months: [], days: [] };
    if (url.includes("/albums")) return { tree: [], smart: [] };
    return { items: [], next_cursor: null, entries: [], albums: [], people: [] };
  });
}

describe("Library updated banner placement", () => {
  it("shows above the library on the desktop shell", async () => {
    emptyLibraryFetch();
    render(<DesktopShell {...common} />);
    expect(await screen.findByTestId("library-updated-note")).toHaveTextContent("Library updated · +1,204 added, −3 removed");
    expect(document.querySelector(".library-note--desktop")).not.toBeNull();
  });

  it("shows above the library on the mobile shell", async () => {
    emptyLibraryFetch();
    render(<MobileShell {...common} />);
    expect(await screen.findByTestId("library-updated-note")).toHaveTextContent("+1,204 added");
    expect(document.querySelector(".library-note--mobile")).not.toBeNull();
  });

  it("does not show without a note", async () => {
    emptyLibraryFetch();
    render(<DesktopShell {...common} me={{ ...ME, libraries: [{ id: 1, display_name: "Family", updated_note: null }] }} />);
    await screen.findByRole("heading", { name: "Library" });
    expect(screen.queryByTestId("library-updated-note")).toBeNull();
  });
});
