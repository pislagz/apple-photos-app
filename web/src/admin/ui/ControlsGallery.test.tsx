import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import ControlsGallery from "./ControlsGallery";

// The #308 screenshot spec depends on this heading and these test ids.
test("gallery shows its h1 and both row-size sections", () => {
  render(<ControlsGallery />);
  expect(screen.getByRole("heading", { name: "Admin controls", level: 1 })).toBeTruthy();
  expect(screen.getByTestId("gallery-compact")).toBeTruthy();
  expect(screen.getByTestId("gallery-touch")).toBeTruthy();
});
