import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, noContentResponse } from "../testHelpers";
import DevicesScreen from "./DevicesScreen";

const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const now = Date.now();
const ago = (s: number) => new Date(now - s * 1000).toISOString();

const SESSION = {
  id: "sess-1",
  username: "alice",
  device: UA_IPHONE,
  created_at: ago(5 * 86400),
  last_seen_at: ago(3 * 86400),
  expires_at: new Date(now + 20 * 86400 * 1000).toISOString(),
  remember_me: false,
  is_current: false,
};
const MINE = { ...SESSION, id: "sess-2", username: "demo-admin", device: null, last_seen_at: ago(5), is_current: true };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DevicesScreen", () => {
  it("groups devices by person with readable names and relative times", async () => {
    mockFetch(() => [SESSION, MINE]);
    render(<DevicesScreen />);
    expect(await screen.findByRole("heading", { name: "alice" })).toBeInTheDocument();
    expect(screen.getByText("Safari on iPhone")).toBeInTheDocument();
    expect(screen.getByText("3 days ago")).toBeInTheDocument();
    expect(screen.getByText("Active now")).toBeInTheDocument();
    expect(screen.queryByText(/2026-|T\d\d:\d\d/)).toBeNull();
  });

  it("gives the current device a reason instead of a Sign Out button", async () => {
    mockFetch(() => [SESSION, MINE]);
    render(<DevicesScreen />);
    await screen.findByText("This device");
    expect(screen.getByText(/can't be signed out here/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Sign out/ })).toHaveLength(1);
  });

  it("asks first, naming the device and the person, and does not call window.confirm", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const fetchMock = mockFetch((_url, init) => {
      if (init?.method === "DELETE") return noContentResponse();
      return [SESSION];
    });
    render(<DevicesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out Safari on iPhone for alice" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Sign out Safari on iPhone for alice?");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/admin/sessions/sess-1", expect.anything());

    fireEvent.click(within(dialog).getByRole("button", { name: "Sign Out" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/sessions/sess-1", expect.objectContaining({ method: "DELETE" })),
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("Cancel leaves the device signed in", async () => {
    const fetchMock = mockFetch(() => [SESSION]);
    render(<DevicesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Sign out/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("sess-1"), expect.objectContaining({ method: "DELETE" }));
  });
});
