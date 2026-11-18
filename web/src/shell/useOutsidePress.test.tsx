import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useOutsidePress } from "./useOutsidePress";

function Probe({ active, onOutside }: { active: boolean; onOutside: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useOutsidePress(active, [ref], onOutside);
  return (
    <div>
      <div ref={ref} data-testid="inside" />
      <button>behind</button>
    </div>
  );
}

describe("useOutsidePress", () => {
  it.each(["mouse", "touch", "pen"])("closes on a %s press outside and swallows its click", (pointerType) => {
    const onOutside = vi.fn();
    const behind = vi.fn();
    render(<Probe active onOutside={onOutside} />);
    const button = screen.getByText("behind");
    button.addEventListener("click", behind);
    fireEvent.pointerDown(button, { pointerType });
    fireEvent.click(button);
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
  });

  it("ignores presses inside, and does nothing while inactive", () => {
    const onOutside = vi.fn();
    const { rerender } = render(<Probe active onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId("inside"));
    expect(onOutside).not.toHaveBeenCalled();
    rerender(<Probe active={false} onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByText("behind"));
    expect(onOutside).not.toHaveBeenCalled();
  });
});
