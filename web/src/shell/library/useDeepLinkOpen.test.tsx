import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssetListItem } from "../../api";
import { useDeepLinkOpen } from "./useDeepLinkOpen";

const item = (id: string) => ({ id }) as AssetListItem;

describe("useDeepLinkOpen", () => {
  it("handles a later id on the same grid (Show in All Photos, #514)", () => {
    const open = vi.fn();
    const items = [item("a"), item("b"), item("c")];
    const { rerender } = renderHook(
      ({ id }: { id?: string }) => useDeepLinkOpen(id, items, false, true, () => {}, open),
      { initialProps: { id: undefined as string | undefined } },
    );
    expect(open).not.toHaveBeenCalled();
    rerender({ id: "c" });
    expect(open).toHaveBeenCalledWith(2);
  });
});
