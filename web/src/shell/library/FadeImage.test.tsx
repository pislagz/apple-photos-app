import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FadeImage, { forgetLoadedForTests } from "./FadeImage";

describe("FadeImage", () => {
  it("starts as a placeholder (data-loaded=false) and flips on load", () => {
    forgetLoadedForTests();
    const { container } = render(<FadeImage src="/a.jpg" alt="" className="mobile-library__cell" />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.className).toContain("fade-image");
    expect(img.className).toContain("mobile-library__cell");
    expect(img.dataset.loaded).toBe("false");
    fireEvent.load(img);
    expect(img.dataset.loaded).toBe("true");
  });

  it("shows a url that already loaded at once, without a fade", () => {
    forgetLoadedForTests();
    const first = render(<FadeImage src="/b.jpg" alt="" />);
    fireEvent.load(first.container.querySelector("img") as HTMLImageElement);
    first.unmount();
    const again = render(<FadeImage src="/b.jpg" alt="" />);
    expect((again.container.querySelector("img") as HTMLImageElement).dataset.loaded).toBe("true");
  });
});
