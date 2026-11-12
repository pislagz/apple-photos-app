import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoginScreen from "./LoginScreen";

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
