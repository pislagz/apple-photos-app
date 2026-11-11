import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AssetListItem } from "../../api";
import { CheckBadge, overlayLevel, TileOverlays } from "./TileOverlays";

const item = (overrides: Partial<AssetListItem> = {}): AssetListItem => ({
  id: "a",
  filename: "a.mov",
  date: "2024-05-10T10:00:00",
  is_video: true,
  is_live_photo: false,
  favorite: true,
  width: 100,
  height: 100,
  duration: 65,
  ...overrides,
});

describe("overlayLevel (#208)", () => {
  it("hides below 48 px, small below 80 px, full from 80 px", () => {
    expect(overlayLevel(47.9)).toBe("none");
    expect(overlayLevel(48)).toBe("small");
    expect(overlayLevel(79.9)).toBe("small");
    expect(overlayLevel(80)).toBe("full");
  });
});

describe("TileOverlays", () => {
  it("shows heart and duration without hover", () => {
    render(<TileOverlays item={item()} tileWidth={120} prefix="x" />);
    expect(screen.getByLabelText("Favorite")).toHaveAttribute("data-overlay", "full");
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("uses the small heart below 80 px", () => {
    render(<TileOverlays item={item()} tileWidth={60} prefix="x" />);
    expect(screen.getByLabelText("Favorite")).toHaveAttribute("data-overlay", "small");
    expect(screen.getByLabelText("Favorite").querySelector("svg")).toHaveAttribute("width", "10");
  });

  it("renders nothing below 48 px", () => {
    const { container } = render(<TileOverlays item={item()} tileWidth={40} prefix="x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("omits heart and duration for a plain photo", () => {
    const { container } = render(
      <TileOverlays item={item({ favorite: false, is_video: false })} tileWidth={120} prefix="x" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("CheckBadge", () => {
  it("carries the selected state", () => {
    const { container, rerender } = render(<CheckBadge prefix="x" selected={false} />);
    expect(container.querySelector(".x__check")).toHaveAttribute("data-selected", "false");
    rerender(<CheckBadge prefix="x" selected />);
    expect(container.querySelector(".x__check")).toHaveAttribute("data-selected", "true");
  });
});
