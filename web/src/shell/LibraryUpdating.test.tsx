import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MeResponse } from "../api";
import DesktopShell from "./DesktopShell";
import LibraryUpdating from "./LibraryUpdating";
import MobileShell from "./MobileShell";

const ME: MeResponse = {
  username: "alice",
  role: "user",
  libraries: [{ id: 1, display_name: "Family", updating: true, updating_reason: "Library file missing since 2026-11-03 14:05 UTC" }],
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

describe("Being updated", () => {
  it("renders the notice with the reason", () => {
    render(<LibraryUpdating name="Family" reason="copy looks incomplete" />);
    expect(screen.getByRole("status").textContent).toContain("Family is being updated");
    expect(screen.getByText("copy looks incomplete")).toBeTruthy();
  });

  it("replaces the grid on the mobile shell without requesting any photos", () => {
    const fetchSpy = (globalThis.fetch = (() => Promise.reject(new Error("no requests expected"))) as typeof fetch);
    render(<MobileShell {...common} />);
    expect(screen.getByText("Family is being updated")).toBeTruthy();
    expect(fetchSpy).toBeDefined();
  });

  it("replaces the grid on the desktop shell", () => {
    globalThis.fetch = (() => Promise.reject(new Error("no requests expected"))) as typeof fetch;
    render(<DesktopShell {...common} />);
    expect(screen.getByText("Family is being updated")).toBeTruthy();
  });
});
