import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  // #258: Photos' badge is an accent circle with a white ring and a white
  // check, not a plain accent dot.
  it("draws a white check in an accent circle with a white ring", () => {
    const { container } = render(<CheckBadge prefix="x" selected />);
    const path = container.querySelector(".x__check svg path");
    expect(path).toHaveAttribute("stroke", "currentColor");
    expect(path).toHaveAttribute("fill", "none");
    const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
    const rule = /\.mobile-library__check \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("color: var(--color-white)");
    expect(css).toMatch(/\.mobile-library__check__fill \{[^}]*fill: var\(--accent\)/);
    expect(css).toMatch(/\.mobile-library__check__ring \{[^}]*stroke: var\(--color-white\)/);
    expect(css).not.toContain("mobile-library__select-badge");
  });

  // Desktop shows the blue frame only; the badge is iPhone-only.
  it("has no desktop check badge styling", () => {
    const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
    expect(css).not.toContain("desktop-library__check");
    expect(/\.desktop-library__cell\[data-selected="true"\] \{([^}]*)\}/.exec(css)?.[1]).toContain("outline: 3px solid var(--accent)");
  });

  // F10: whole-pixel geometry, tick centred on the circle, nothing that can
  // settle after the first frame.
  it("is pixel-centred and static", () => {
    const { container } = render(<CheckBadge prefix="x" selected />);
    const d = container.querySelector(".x__check svg path")?.getAttribute("d") ?? "";
    const pts = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(pts.length).toBe(3);
    for (const [x, y] of pts) {
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
    }
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(11);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBe(11);
    const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
    const rule = /\.mobile-library__check \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).not.toMatch(/border:|transform|transition|margin/);
    expect(css).not.toMatch(/\.mobile-library__check svg \{[^}]*margin/);
  });

  // F2: no white click/active/focus flash on desktop tiles.
  it("desktop tiles have no flash, tap highlight, or keyboard-only focus ring", () => {
    const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
    expect(css).not.toContain("data-flash");
    expect(css).not.toContain("tile-flash");
    expect(/\.desktop-library__cell \{([^}]*)\}/.exec(css)?.[1]).toContain("-webkit-tap-highlight-color: transparent");
    expect(css).toMatch(/\.desktop-library__cell:focus-visible/);
    expect(css).not.toMatch(/\.desktop-library__cell:(focus|active)\b(?!-visible)[^{]*\{[^}]*(background|opacity)/);
  });

  // F6: the scrollbar must not change the measured width.
  it("desktop grid reserves its scrollbar gutter (no resize feedback loop)", () => {
    const css = readFileSync(join(__dirname, "..", "shell.css"), "utf-8");
    expect(/\.desktop-library__grid \{([^}]*)\}/.exec(css)?.[1]).toContain("scrollbar-gutter: stable");
  });
});
