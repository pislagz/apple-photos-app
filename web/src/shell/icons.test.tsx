import { render } from "@testing-library/react";
import IconGallery from "./IconGallery";
import { ICONS, ICON_NAMES, Icon, hasFilledVariant } from "./icons";

describe("icon set", () => {
  it.each(ICON_NAMES)("%s renders an svg with a non-empty path, outline and filled", (name) => {
    for (const filled of [false, true]) {
      const { container, unmount } = render(<Icon name={name} filled={filled} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 20 20");
      const paths = [...container.querySelectorAll("g > path")];
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) expect(path.getAttribute("d")?.length ?? 0).toBeGreaterThan(5);
      unmount();
    }
  });

  it("keeps the Icon API: name, size, className", () => {
    const { container } = render(<Icon name="search" size={24} className="x" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("24");
    expect(svg?.getAttribute("class")).toBe("x");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("covers every icon name the app uses", () => {
    const used = [
      "library", "days", "albums", "people", "map", "favorite", "added", "folder", "hidden", "tray",
      "grid", "search", "download", "filter", "chevron", "sidebar", "trash", "info", "share", "aspect", "plus", "minus",
      "more", "play", "close", "livephoto", "video", "camera", "portrait", "panorama", "screenshot",
      "document", "link", "original", "slomo", "edited", "zoomIn", "zoomOut", "shared", "notInAlbum",
    ];
    expect([...ICON_NAMES].sort()).toEqual([...used].sort());
  });

  it("has a filled variant for every icon shown in a selected sidebar row or tab", () => {
    const selectable = [
      "library", "days", "albums", "favorite", "people", "map", "added", "folder", "hidden", "tray",
      "video", "camera", "livephoto", "portrait", "panorama", "screenshot", "document", "info",
    ] as const;
    for (const name of selectable) expect(hasFilledVariant(name), name).toBe(true);
  });

  it("filled variants draw something different from the outline", () => {
    for (const name of ICON_NAMES.filter(hasFilledVariant)) {
      const def = ICONS[name] as { parts: unknown; filled: unknown };
      expect(JSON.stringify(def.filled), name).not.toBe(JSON.stringify(def.parts));
    }
  });

  it("falls back to a heavier stroke for icons without a filled variant", () => {
    const { container } = render(<Icon name="search" filled />);
    expect(container.querySelector("g > path")?.getAttribute("stroke-width")).toBe("2");
  });

  it("gallery shows each icon four times", () => {
    const { container } = render(<IconGallery />);
    expect(container.querySelectorAll("svg")).toHaveLength(ICON_NAMES.length * 4);
  });
});
