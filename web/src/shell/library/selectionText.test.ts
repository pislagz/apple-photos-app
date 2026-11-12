import { describe, expect, it } from "vitest";
import type { AssetListItem } from "../../api";
import { selectionCountLabel } from "./selectionText";

const item = (id: string, is_video = false) => ({ id, is_video }) as AssetListItem;
const items = [item("p1"), item("p2"), item("v1", true), item("v2", true)];

describe("selectionCountLabel (#259)", () => {
  it("asks for a selection when nothing is selected", () => {
    expect(selectionCountLabel(items, new Set())).toBe("Select Items");
  });

  it("names photos, videos and a mix like Photos does", () => {
    expect(selectionCountLabel(items, new Set(["p1"]))).toBe("1 Photo Selected");
    expect(selectionCountLabel(items, new Set(["p1", "p2"]))).toBe("2 Photos Selected");
    expect(selectionCountLabel(items, new Set(["v1"]))).toBe("1 Video Selected");
    expect(selectionCountLabel(items, new Set(["v1", "v2"]))).toBe("2 Videos Selected");
    expect(selectionCountLabel(items, new Set(["p1", "v1", "v2"]))).toBe("3 Items Selected");
  });

  it("calls an id it cannot see an item", () => {
    expect(selectionCountLabel(items, new Set(["p1", "gone"]))).toBe("2 Items Selected");
  });
});
