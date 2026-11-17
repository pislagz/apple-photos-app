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

describe("More > Transfer Format (#507)", () => {
  it("lists Automatic (selected) and Keep Originals, saves the choice, and has no ZIP switch", () => {
    setup();
    expect(screen.getByRole("radiogroup", { name: "Transfer Format" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Automatic" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Keep Originals" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Photos are sent as JPEG, the most compatible format/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Keep Originals" }));
    expect(localStorage.getItem("photos-viewer:transfer-format")).toBe("original");
    expect(screen.getByRole("radio", { name: "Keep Originals" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Photos are sent as HEIC/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("Download as ZIP")).toBeNull();
  });
});
