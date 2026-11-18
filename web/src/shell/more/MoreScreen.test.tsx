import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibrarySummary, MeResponse } from "../../api";
import MoreScreen from "./MoreScreen";

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
