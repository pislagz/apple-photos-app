import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ZoomSlider from "./ZoomSlider";

describe("ZoomSlider (#434)", () => {
  it("keeps the Zoom Out / Zoom / Zoom In labels and reports changes and steps", () => {
    const onChange = vi.fn();
    const onStep = vi.fn();
    render(<ZoomSlider min={1} max={5} step={0.5} value={2} onChange={onChange} onStep={onStep} testId="z" />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom In" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom Out" }));
    expect(onStep.mock.calls).toEqual([[1], [-1]]);
    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), { target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith(3);
    expect(screen.getByTestId("z")).toBe(screen.getByRole("slider", { name: "Zoom" }));
  });

  it("disables the end buttons at the limits and fills the track proportionally", () => {
    const { rerender } = render(<ZoomSlider min={1} max={5} value={1} onChange={() => {}} onStep={() => {}} />);
    expect(screen.getByRole("button", { name: "Zoom Out" })).toBeDisabled();
    rerender(<ZoomSlider min={1} max={5} value={5} onChange={() => {}} onStep={() => {}} />);
    expect(screen.getByRole("button", { name: "Zoom In" })).toBeDisabled();
    expect((screen.getByRole("slider") as HTMLInputElement).style.getPropertyValue("--range-fill")).toBe("100%");
  });
});
