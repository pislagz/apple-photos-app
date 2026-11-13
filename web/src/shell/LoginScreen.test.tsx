import { fireEvent, render, screen } from "@testing-library/react";
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

function fill() {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ann" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
}

describe("LoginScreen keep me signed in", () => {
  it("is ticked by default and submits rememberMe true", () => {
    const onSubmit = vi.fn();
    render(<LoginScreen layout="desktop" error={null} onSubmit={onSubmit} />);
    const box = screen.getByLabelText("Keep me signed in") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSubmit).toHaveBeenCalledWith("ann", "pw", true);
  });

  it("submits false once unticked", () => {
    const onSubmit = vi.fn();
    render(<LoginScreen layout="desktop" error={null} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByLabelText("Keep me signed in"));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSubmit).toHaveBeenCalledWith("ann", "pw", false);
  });

  it("starts unticked when the admin default is off", () => {
    render(<LoginScreen layout="desktop" error={null} keepSignedIn="default_off" onSubmit={vi.fn()} />);
    expect((screen.getByLabelText("Keep me signed in") as HTMLInputElement).checked).toBe(false);
  });

  it("hides the box and sends false when the admin disabled it", () => {
    const onSubmit = vi.fn();
    render(<LoginScreen layout="desktop" error={null} keepSignedIn="disabled" onSubmit={onSubmit} />);
    expect(screen.queryByLabelText("Keep me signed in")).toBeNull();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSubmit).toHaveBeenCalledWith("ann", "pw", false);
  });
});

describe("LoginScreen layout (F1)", () => {
  it("renders the keep box inside a label carrying the inline-row class", () => {
    render(<LoginScreen layout="mobile" error={null} onSubmit={vi.fn()} />);
    const box = screen.getByLabelText("Keep me signed in");
    expect(box.closest("label")).toHaveClass("login-card__keep");
  });
});
