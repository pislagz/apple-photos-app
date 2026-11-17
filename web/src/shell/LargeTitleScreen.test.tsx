import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LargeTitleScreen from "./LargeTitleScreen";

describe("LargeTitleScreen (#478)", () => {
  it("keeps the large title in the scroll area and shows the small bar title once scrolled", () => {
    const { container } = render(
      <LargeTitleScreen title="More">
        <p>row</p>
      </LargeTitleScreen>,
    );
    const scroll = screen.getByTestId("large-title-scroll");
    expect(scroll.querySelector("h1")).toHaveTextContent("More");
    const bar = container.querySelector(".large-title-bar");
    expect(bar).toHaveAttribute("data-collapsed", "false");
    scroll.scrollTop = 80;
    fireEvent.scroll(scroll);
    expect(bar).toHaveAttribute("data-collapsed", "true");
    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);
    expect(bar).toHaveAttribute("data-collapsed", "false");
  });
});
