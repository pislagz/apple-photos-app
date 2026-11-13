import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../api";
import * as api from "../api";
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

  describe("hover intent", () => {
    afterEach(() => vi.useRealTimers());

    const hover = (name: string, x = 0, y = 0) =>
      fireEvent.mouseMove(screen.getByRole("menuitem", { name }), { clientX: x, clientY: y });

    it("opens a submenu after a short delay and keeps it open", () => {
      vi.useFakeTimers();
      setup();
      fireEvent.click(trigger());
      hover("Layout", 10, 10);
      expect(screen.queryByRole("menu", { name: "Layout" })).not.toBeInTheDocument();
      act(() => void vi.advanceTimersByTime(200));
      const sub = screen.getByRole("menu", { name: "Layout" });
      // Pointer enters the submenu, then rests there: it stays open.
      fireEvent.mouseEnter(sub);
      act(() => void vi.advanceTimersByTime(2000));
      expect(screen.getByRole("menu", { name: "Layout" })).toBeInTheDocument();
    });

    it("closes the submenu when the pointer moves to a plain item", () => {
      vi.useFakeTimers();
      setup();
      fireEvent.click(trigger());
      hover("Layout", 10, 10);
      act(() => void vi.advanceTimersByTime(200));
      hover("Log Out", 10, 200);
      act(() => void vi.advanceTimersByTime(10));
      expect(screen.queryByRole("menu", { name: "Layout" })).not.toBeInTheDocument();
    });

    it("keeps the submenu through a grace period on a diagonal move, then switches", () => {
      vi.useFakeTimers();
      setup();
      fireEvent.click(trigger());
      hover("Layout", 10, 10);
      act(() => void vi.advanceTimersByTime(200));
      // jsdom has no layout: give the submenu a real rectangle to aim at.
      const sub = screen.getByRole("menu", { name: "Layout" });
      sub.getBoundingClientRect = () => ({ left: 100, right: 300, top: 0, bottom: 200, width: 200, height: 200, x: 100, y: 0, toJSON() {} });
      hover("Layout", 10, 10);
      hover("Passkeys…", 40, 20); // heading toward the submenu: inside the triangle
      act(() => void vi.advanceTimersByTime(100));
      expect(screen.getByRole("menu", { name: "Layout" })).toBeInTheDocument();
      fireEvent.mouseEnter(sub); // arrives in time
      act(() => void vi.advanceTimersByTime(1000));
      expect(screen.getByRole("menu", { name: "Layout" })).toBeInTheDocument();
    });
  });

  it("offers Choose Avatar… (only with libraries) and Remove Avatar only when one is set", () => {
    setup({ ...USER, libraries: [] });
    fireEvent.click(trigger());
    expect(screen.queryByRole("menuitem", { name: "Choose Avatar…" })).not.toBeInTheDocument();
    cleanup();
    const lib = { id: 1, display_name: "Family", updating: false, updating_reason: null, updated_note: null };
    setup({ ...USER, libraries: [lib] });
    fireEvent.click(trigger());
    expect(screen.getByRole("menuitem", { name: "Choose Avatar…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Remove Avatar" })).not.toBeInTheDocument();
  });

  it("Remove Avatar calls the server and asks for a refresh", async () => {
    const remove = vi.spyOn(api, "removeAvatar").mockResolvedValue(undefined);
    const onAvatarChanged = vi.fn();
    setup({ ...USER, avatar_version: 7 }, { onAvatarChanged });
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/api/users/alice/avatar?v=7");
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove Avatar" }));
    await vi.waitFor(() => expect(onAvatarChanged).toHaveBeenCalled());
    expect(remove).toHaveBeenCalled();
  });

  it("falls back to the initial when the avatar image is missing", () => {
    setup({ ...USER, avatar_version: 7 });
    fireEvent.error(document.querySelector("img")!);
    expect(document.querySelector("img")).toBeNull();
    expect(trigger()).toHaveTextContent("A");
  });
});
