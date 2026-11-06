import { describe, expect, it } from "vitest";
import type { AssetListItem } from "../../api";
import { anchoredScrollTop, assetIdAtPoint, findRowIndexByAsset } from "./pinchAnchor";
import type { LibraryRow } from "./rows";

const item = (id: string) => ({ id }) as AssetListItem;
const grid = (key: string, ids: string[]): LibraryRow => ({ type: "grid", key, label: "", items: ids.map(item) });

describe("pinchAnchor", () => {
  it("picks the asset column under the point, clamped to the row", () => {
    const row = grid("r", ["a", "b", "c"]);
    expect(assetIdAtPoint(row, 0, 100)).toBe("a");
    expect(assetIdAtPoint(row, 150, 100)).toBe("b");
    expect(assetIdAtPoint(row, 390, 100)).toBe("c");
  });

  it("uses the hero for feature rows and nothing for headers/tiles", () => {
    expect(assetIdAtPoint({ type: "feature", key: "f", label: "", items: [item("h")] }, 300, 100)).toBe("h");
    expect(assetIdAtPoint({ type: "header", key: "h", label: "" }, 0, 100)).toBeNull();
    expect(assetIdAtPoint(undefined, 0, 100)).toBeNull();
  });

  it("finds the row holding an asset after a re-flow", () => {
    const rows = [grid("a", ["1", "2"]), grid("b", ["3", "4"])];
    expect(findRowIndexByAsset(rows, "4")).toBe(1);
    expect(findRowIndexByAsset(rows, "9")).toBe(-1);
  });

  it("keeps the pinched point at the same viewport offset", () => {
    // 4 -> 2 columns: asset's row now starts at 1000, is 200 tall; the point
    // was mid-row, 300px down the viewport.
    expect(anchoredScrollTop({ rowFraction: 0.5, viewportY: 300 }, 1000, 200, 5000, 800)).toBe(800);
  });

  it("clamps to the scrollable range", () => {
    expect(anchoredScrollTop({ rowFraction: 0, viewportY: 300 }, 100, 50, 5000, 800)).toBe(0);
    expect(anchoredScrollTop({ rowFraction: 1, viewportY: 0 }, 4900, 200, 5000, 800)).toBe(4200);
  });
});
