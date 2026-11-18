import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { MeResponse } from "../../api";
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
