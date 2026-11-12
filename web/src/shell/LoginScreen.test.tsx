import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginScreen from "./LoginScreen";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubBrowser(hostname: string, isSecureContext: boolean) {
  vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
  vi.stubGlobal("navigator", { credentials: {} });
  vi.stubGlobal("isSecureContext", isSecureContext);
  vi.stubGlobal("location", { hostname });
}

describe("LoginScreen passkey button", () => {
  it("is hidden with a plain-language note over plain http", () => {
    stubBrowser("homeserver.local", false);
    render(<LoginScreen layout="desktop" error={null} onSubmit={() => {}} onPasskey={() => {}} />);
    expect(screen.queryByText("Sign in with a passkey")).toBeNull();
    expect(screen.getByText(/Passkeys need a secure \(https\) connection/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("is shown over https on a host name", () => {
    stubBrowser("myhost.tailxyz.ts.net", true);
    render(<LoginScreen layout="desktop" error={null} onSubmit={() => {}} onPasskey={() => {}} />);
    expect(screen.getByText("Sign in with a passkey")).toBeTruthy();
    expect(screen.queryByText(/Passkeys need/)).toBeNull();
  });
});
