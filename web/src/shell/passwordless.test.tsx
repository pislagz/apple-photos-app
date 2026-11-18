import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MoreScreen from "./more/MoreScreen";
import type { MeResponse } from "../api";

const BASE: MeResponse = { username: "kid", role: "user", libraries: [], layout_override: null };

// #520 hides Utilities by default; turn Hidden on so only has_password decides.
const LIBS = [{ id: 1, name: "Library", utilities: { enabled: true, imports: false, hidden: true } }] as unknown as Parameters<typeof MoreScreen>[0]["libraries"];

function renderMore(me: MeResponse) {
  return render(<MoreScreen me={me} libraries={LIBS} activeLibraryId={1} onActiveLibraryChange={() => {}} onNavigate={() => {}} onLogout={() => {}} />);
}

describe("passwordless accounts (#519)", () => {
  it("never see Hidden or Change password on More, and are told to ask an admin", () => {
    renderMore({ ...BASE, has_password: false });
    expect(screen.queryByRole("button", { name: "Hidden" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
    expect(screen.getByText(/Ask an admin to set one/)).toBeTruthy();
  });

  it("keep Hidden and Change password when they have a password", () => {
    renderMore({ ...BASE, has_password: true });
    expect(screen.getByRole("button", { name: "Hidden" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change password" })).toBeTruthy();
  });
});
