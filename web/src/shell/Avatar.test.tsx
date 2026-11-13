import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Avatar from "./Avatar";

afterEach(cleanup);

describe("Avatar (#256)", () => {
  it("shows the initial when there is no picture", () => {
    const { container } = render(<Avatar username="alice" version={null} />);
    expect(container.textContent).toBe("A");
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the picture, versioned so a new one is re-fetched", () => {
    const { container } = render(<Avatar username="alice" version={42} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/users/alice/avatar?v=42");
  });

  it("falls back to the initial when the picture fails to load, and retries for a new version", () => {
    const { container, rerender } = render(<Avatar username="alice" version={1} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("A");
    rerender(<Avatar username="alice" version={2} />);
    expect(container.querySelector("img")).not.toBeNull();
  });
});
