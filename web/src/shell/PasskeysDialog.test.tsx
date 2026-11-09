import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, noContentResponse } from "../testHelpers";
import LoginScreen from "./LoginScreen";
import PasskeysDialog from "./PasskeysDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function supportWebAuthn(credentials: Record<string, unknown> = {}) {
  vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
  vi.stubGlobal("navigator", { credentials });
}

const PASSKEY = { id: "p1", name: "My iPhone", created_at: "2026-01-02 03:04:05", last_used_at: null };

describe("PasskeysDialog (P3.1)", () => {
  it("lists passkeys and removes one", async () => {
    supportWebAuthn();
    let removed = false;
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/auth/passkeys" && !init?.method) return jsonResponse(removed ? [] : [PASSKEY]);
      if (url === "/api/auth/passkeys/p1" && init?.method === "DELETE") {
        removed = true;
        return noContentResponse();
      }
      throw new Error(`unexpected request: ${url}`);
    });
    render(<PasskeysDialog onClose={() => {}} />);

    expect(await screen.findByText("My iPhone")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove My iPhone" }));

    expect(await screen.findByText("No passkeys yet.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/auth/passkeys/p1" && init?.method === "DELETE")).toBe(true);
  });

  it("explains when the browser cannot create passkeys", async () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    mockFetch(() => jsonResponse([]));
    render(<PasskeysDialog onClose={() => {}} />);
    expect(await screen.findByText("This browser can’t create passkeys.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a passkey" })).not.toBeInTheDocument();
  });

  it("stays quiet when the user dismisses the browser's passkey sheet", async () => {
    const create = vi.fn().mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));
    supportWebAuthn({ create });
    mockFetch((url) => {
      if (url === "/api/auth/passkeys") return jsonResponse([]);
      if (url === "/api/auth/passkeys/register/options") {
        return jsonResponse({ challenge_id: "c", options: { challenge: "AQID", user: { id: "BAUG", name: "a" } } });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    render(<PasskeysDialog onClose={() => {}} />);
    await screen.findByText("No passkeys yet.");

    fireEvent.click(screen.getByRole("button", { name: "Add a passkey" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("LoginScreen passkey button (P3.1)", () => {
  it("shows the passkey button when WebAuthn exists and calls onPasskey", () => {
    supportWebAuthn();
    const onPasskey = vi.fn();
    render(<LoginScreen layout="desktop" error={null} onSubmit={() => {}} onPasskey={onPasskey} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }));
    expect(onPasskey).toHaveBeenCalledOnce();
  });

  it("hides the passkey button when the browser lacks WebAuthn", () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    render(<LoginScreen layout="mobile" error={null} onSubmit={() => {}} onPasskey={() => {}} />);
    expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
