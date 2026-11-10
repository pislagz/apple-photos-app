import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, noContentResponse } from "../testHelpers";
import ChangePasswordDialog from "./ChangePasswordDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fill(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
}

describe("ChangePasswordDialog (#71)", () => {
  it("posts the passwords and says other devices were signed out", async () => {
    const fetchMock = mockFetch((url) => {
      if (url === "/api/auth/change-password") return noContentResponse();
      throw new Error(`unexpected request: ${url}`);
    });
    render(<ChangePasswordDialog onClose={() => {}} />);

    fill("old-password-1", "a-brand-new-passphrase", "a-brand-new-passphrase");

    expect(await screen.findByRole("status")).toHaveTextContent("other devices have been signed out");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      current_password: "old-password-1",
      new_password: "a-brand-new-passphrase",
    });
  });

  it("rejects a mismatched or short new password without calling the server", () => {
    const fetchMock = mockFetch(() => {
      throw new Error("must not be called");
    });
    render(<ChangePasswordDialog onClose={() => {}} />);

    fill("old-password-1", "a-brand-new-passphrase", "something-different-1");
    expect(screen.getByRole("alert")).toHaveTextContent("don’t match");
    fill("old-password-1", "short", "short");
    expect(screen.getByRole("alert")).toHaveTextContent("at least 12");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an incorrect-current-password error on 401", async () => {
    mockFetch(() => jsonResponse({ detail: "wrong password" }, 401));
    render(<ChangePasswordDialog onClose={() => {}} />);

    fill("wrong-password-1", "a-brand-new-passphrase", "a-brand-new-passphrase");

    expect(await screen.findByRole("alert")).toHaveTextContent("Current password is incorrect.");
  });
});
