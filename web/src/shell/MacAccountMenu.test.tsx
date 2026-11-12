import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../api";
import MacAccountMenu from "./MacAccountMenu";

afterEach(cleanup);

const USER: MeResponse = { username: "alice", role: "user", libraries: [], layout_override: null };
const ADMIN: MeResponse = { ...USER, role: "admin" };
const LIBS = [
  { id: 1, display_name: "Family" },
  { id: 2, display_name: "Travel" },
];

function setup(me = USER, extra: Partial<Parameters<typeof MacAccountMenu>[0]> = {}) {
  const props = {
    me,
    layoutOverride: "auto" as const,
    onLayoutOverrideChange: vi.fn(),
    onLogout: vi.fn(),
    libraries: LIBS,
    activeLibraryId: 1,
    onActiveLibraryChange: vi.fn(),
    ...extra,
  };
  render(<MacAccountMenu {...props} />);
  return props;
}

const trigger = () => screen.getByRole("button", { name: "Account menu" });

describe("MacAccountMenu (#292)", () => {
  it("opens from the row, focuses the first item and lists the macOS items", () => {
    setup();
    fireEvent.click(trigger());
    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Admin…" })).not.toBeInTheDocument();
    for (const name of ["Library", "Layout", "Change Password…", "Passkeys…", "Log Out"]) {
      expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Library" }));
  });

  it("shows Admin… first for admins", () => {
    setup(ADMIN);
    fireEvent.click(trigger());
    expect(screen.getAllByRole("menuitem")[0]).toHaveAccessibleName("Admin…");
  });

  it("marks the current layout and applies a choice", () => {
    const props = setup(USER, { layoutOverride: "desktop" });
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Layout" }));
    expect(screen.getByRole("menuitemradio", { name: "Desktop" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Automatic" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "iPhone" }));
    expect(props.onLayoutOverrideChange).toHaveBeenCalledWith("mobile");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger());
  });

  it("navigates with arrow keys, opens submenus with Right and closes them with Left", () => {
    setup();
    fireEvent.click(trigger());
    const root = screen.getByRole("menu", { name: "Account" });
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Layout" }));
    fireEvent.keyDown(root, { key: "ArrowRight" });
    const sub = screen.getByRole("menu", { name: "Layout" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Automatic" }));
    fireEvent.keyDown(sub, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Desktop" }));
    fireEvent.keyDown(sub, { key: "ArrowLeft" });
    expect(screen.queryByRole("menu", { name: "Layout" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Layout" }));
  });

  it("switches library from the Library submenu", () => {
    const props = setup();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Library" }));
    expect(screen.getByRole("menuitemradio", { name: "Family" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Travel" }));
    expect(props.onActiveLibraryChange).toHaveBeenCalledWith(2);
  });

  it("Escape closes the menu and returns focus to the row", () => {
    setup();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("menu", { name: "Account" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("logs out and opens the password and passkey dialogs", () => {
    const props = setup();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Change Password…" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger());
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Log Out" }));
    expect(props.onLogout).toHaveBeenCalled();
  });
});
