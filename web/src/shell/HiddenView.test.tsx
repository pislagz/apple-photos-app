import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, noContentResponse } from "../testHelpers";
import HiddenView from "./HiddenView";

afterEach(() => vi.unstubAllGlobals());

const LOCKED = { detail: { code: "hidden_locked", message: "password required to open Hidden" } };

// #148: Hidden re-locks server-side after 5 idle minutes; the next request
// 403s `hidden_locked`. The view must show the password prompt, then resume.
describe.each(["mobile", "desktop"] as const)("HiddenView re-lock (%s)", (variant) => {
  it("shows the password prompt on hidden_locked and reloads the list after unlock", async () => {
    let hiddenCalls = 0;
    const fetchMock = mockFetch((url) => {
      if (url === "/api/libraries/1/hidden") {
        hiddenCalls += 1;
        if (hiddenCalls === 1) return jsonResponse(LOCKED, 403);
        return { items: [{ id: "a1", filename: "secret.jpg" }], next_cursor: null };
      }
      if (url === "/api/auth/reconfirm-password") return noContentResponse();
      throw new Error(`unexpected request: ${url}`);
    });

    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);

    expect(await screen.findByText("Hidden is locked")).toBeInTheDocument();
    expect(screen.queryByText("No hidden photos.")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText("secret.jpg")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(hiddenCalls).toBe(2);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/reconfirm-password")).toBe(true);
  });

  it("cancel from the re-lock prompt calls onCancel", async () => {
    mockFetch(() => jsonResponse(LOCKED, 403));
    const onCancel = vi.fn();
    render(<HiddenView libraryId={1} variant={variant} onCancel={onCancel} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("other errors still show the empty state, not the prompt", async () => {
    mockFetch(() => jsonResponse({ detail: "boom" }, 500));
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    expect(await screen.findByText("No hidden photos.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });
});
