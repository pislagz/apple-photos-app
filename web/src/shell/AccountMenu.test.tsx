import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MeResponse } from "../api";
import { afterEach, describe, expect, it } from "vitest";
import AccountMenu from "./AccountMenu";

afterEach(cleanup);

const ME: MeResponse = { username: "alice", role: "user", libraries: [], layout_override: null };

describe("AccountMenu (#189)", () => {
  it("closes the popover when the Change password dialog closes", () => {
    render(
      <AccountMenu
        me={ME}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
        compact
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change password" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account menu" })).toHaveAttribute("aria-expanded", "false");
  });

  it("lists Choose avatar… and, once set, Remove avatar, as actionable buttons (#256)", () => {
    const lib = { id: 1, display_name: "Family", updating: false, updating_reason: null, updated_note: null };
    render(
      <AccountMenu
        me={{ ...ME, libraries: [lib], avatar_version: 3 }}
        layoutOverride="auto"
        onLayoutOverrideChange={() => {}}
        onLogout={() => {}}
        compact
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    for (const name of ["Choose avatar…", "Remove avatar", "Change password", "Passkeys", "Log out"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "Choose avatar" }));
    expect(screen.getByRole("dialog", { name: "Choose a photo" })).toBeInTheDocument();
  });
});
