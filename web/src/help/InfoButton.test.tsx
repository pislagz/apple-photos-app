import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HELP } from "./adminHelp";
import InfoButton from "./InfoButton";

const JARGON = /HEIC|WebAuthn|origin\b|JSON|API\b/i;

describe("help registry", () => {
  it("has non-empty, short, jargon-free text for every key", () => {
    for (const [key, text] of Object.entries(HELP)) {
      expect(text.trim().length, key).toBeGreaterThan(20);
      expect(text, key).not.toMatch(JARGON);
    }
  });
});

describe("InfoButton", () => {
  function setup() {
    render(<InfoButton helpKey="changePassword" name="Password" />);
    return screen.getByRole("button", { name: "About Password" });
  }
  const tip = () => document.querySelector<HTMLElement>('[role="tooltip"]')!;

  it("links the text with aria-describedby and starts closed", () => {
    const button = setup();
    expect(button.getAttribute("aria-describedby")).toBe(tip().id);
    expect(tip().textContent).toBe(HELP.changePassword);
    expect(tip().hidden).toBe(true);
  });

  it("opens on hover and closes on leave", () => {
    const button = setup();
    fireEvent.mouseEnter(button);
    expect(tip().hidden).toBe(false);
    fireEvent.mouseLeave(button);
    expect(tip().hidden).toBe(true);
  });

  it("opens on keyboard focus and closes with Escape", () => {
    const button = setup();
    act(() => button.focus());
    expect(tip().hidden).toBe(false);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip().hidden).toBe(true);
  });

  it("opens on tap, stays open, and closes on a tap outside", () => {
    const button = setup();
    fireEvent.click(button);
    expect(tip().hidden).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(tip().hidden).toBe(true);
  });

  it("toggles on a second tap", () => {
    const button = setup();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(tip().hidden).toBe(true);
  });
});

