import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MoreScreen from "../more/MoreScreen";
import { getDownloadAsZip, setDownloadAsZip, useDownloadAsZip } from "./exportPrefs";

afterEach(() => localStorage.clear());

describe("Download as ZIP preference", () => {
  it("is off by default and persists", () => {
    expect(getDownloadAsZip()).toBe(false);
    setDownloadAsZip(true);
    expect(getDownloadAsZip()).toBe(true);
    setDownloadAsZip(false);
    expect(getDownloadAsZip()).toBe(false);
  });

  it("keeps every mounted reader in step", () => {
    const first = renderHook(() => useDownloadAsZip());
    const second = renderHook(() => useDownloadAsZip());
    act(() => first.result.current[1](true));
    expect(second.result.current[0]).toBe(true);
  });

  it("the More tab has the switch, off by default", () => {
    const me = { username: "u", role: "user", libraries: [], avatar_version: null } as never;
    render(<MoreScreen libraries={[]} activeLibraryId={undefined} onActiveLibraryChange={() => {}} onNavigate={() => {}} me={me} onLogout={() => {}} />);
    const toggle = screen.getByRole("switch", { name: "Download as ZIP" });
    expect(toggle).not.toBeChecked();
    act(() => toggle.click());
    expect(getDownloadAsZip()).toBe(true);
    expect(toggle).toBeChecked();
  });
});
