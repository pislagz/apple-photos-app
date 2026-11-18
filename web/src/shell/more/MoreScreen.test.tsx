import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibrarySummary, MeResponse } from "../../api";
import MoreScreen from "./MoreScreen";

const ME = { username: "pp", role: "user", libraries: [], avatar_version: null } as unknown as MeResponse;

function setup() {
  return render(
    <MoreScreen libraries={[]} activeLibraryId={undefined} onActiveLibraryChange={() => {}} onNavigate={() => {}} me={ME} onLogout={() => {}} />,
  );
}

beforeEach(() => localStorage.clear());

describe("More > Photo Format (#507, #512)", () => {
  it("lists Most Compatible (JPEG) (selected) and HEIC (Original Format), saves the choice, and has no ZIP switch", () => {
    setup();
    expect(screen.getByRole("radiogroup", { name: "Photo Format" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Most Compatible (JPEG)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "HEIC (Original Format)" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("For sharing. Edits are always included.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "HEIC (Original Format)" }));
    expect(localStorage.getItem("photos-viewer:transfer-format")).toBe("original");
    expect(screen.getByRole("radio", { name: "HEIC (Original Format)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("For sharing. Edits are always included.")).toBeInTheDocument();
    expect(screen.queryByText("Transfer Format")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("Download as ZIP")).toBeNull();
  });
});

afterEach(() => vi.unstubAllGlobals());

function renderMore(utilities?: LibrarySummary["utilities"]) {
  const library: LibrarySummary = { id: 1, display_name: "Family", utilities };
  const me: MeResponse = { username: "alice", role: "user", libraries: [library], layout_override: null };
  render(
    <MoreScreen
      libraries={[library]}
      activeLibraryId={1}
      onActiveLibraryChange={() => {}}
      onNavigate={() => {}}
      me={me}
      onLogout={() => {}}
    />,
  );
}

describe("MoreScreen Utilities (#518)", () => {
  it("is absent by default", () => {
    renderMore();
    expect(screen.queryByText("Utilities")).toBeNull();
    expect(screen.queryByRole("button", { name: /Hidden/ })).toBeNull();
  });

  it("shows only the items the admin turned on", () => {
    renderMore({ enabled: true, imports: true, hidden: false });
    expect(screen.getByText("Utilities")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Imports/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hidden/ })).toBeNull();
  });

  it("shows Hidden when it is on", () => {
    renderMore({ enabled: true, imports: false, hidden: true });
    expect(screen.getByRole("button", { name: /Hidden/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Imports/ })).toBeNull();
  });
});
