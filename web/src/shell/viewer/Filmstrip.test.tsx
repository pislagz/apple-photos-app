import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AssetListItem } from "../../api";
import { useFakeLayout } from "../../testLayout";
import { Filmstrip } from "./Filmstrip";

useFakeLayout();

const items: AssetListItem[] = Array.from({ length: 5000 }, (_, i) => ({
  id: `a${i}`,
  filename: `a${i}.jpg`,
  date: "2024-05-10T10:00:00",
  is_video: false,
  is_live_photo: false,
  favorite: false,
  width: 100,
  height: 100,
  duration: null,
}));

describe("Filmstrip (#114)", () => {
  it("mounts only the thumbs near the visible span, however large the library", () => {
    render(<Filmstrip libraryId={1} items={items} index={0} onSelect={() => {}} className="strip" itemSize={44} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.length).toBeLessThan(60);
  });

  it("keeps the current item mounted even far beyond the old +-25 window", () => {
    render(<Filmstrip libraryId={1} items={items} index={3000} onSelect={() => {}} className="strip" itemSize={44} />);
    const current = screen.getAllByRole("button").find((b) => b.getAttribute("aria-current") === "true");
    expect(current?.querySelector("img")?.getAttribute("src")).toContain("/thumb/a3000?");
  });
});
