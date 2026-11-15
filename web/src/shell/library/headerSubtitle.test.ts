import { describe, expect, it } from "vitest";
import type { AssetListItem } from "../../api";
import { formatSubtitleDate, subtitleForRow } from "./headerSubtitle";

const item = { id: "a", date: "2024-05-10T10:00:00" } as AssetListItem;

describe("header subtitle (#212)", () => {
  it("is month and year at 3 columns or fewer in All Photos", () => {
    expect(formatSubtitleDate("2024-05-10T10:00:00", 3, "all")).toBe("May 2024");
    expect(formatSubtitleDate("2024-05-10T10:00:00", 2, "all")).toBe("May 2024");
  });
  it("is the full day at 4 columns or more, and always in Days", () => {
    expect(formatSubtitleDate("2024-05-10T10:00:00", 5, "all")).toBe("10 May 2024");
    expect(formatSubtitleDate("2024-05-10T10:00:00", 3, "days")).toBe("10 May 2024");
  });
  it("is empty without a date", () => {
    expect(formatSubtitleDate(null, 4, "all")).toBe("");
    expect(formatSubtitleDate("", 4, "all")).toBe("");
  });
  it("follows grid and feature rows, and is empty for tiles and headers", () => {
    expect(subtitleForRow({ type: "grid", key: "k", label: "", items: [item] }, 5, "all")).toBe("10 May 2024");
    expect(subtitleForRow({ type: "feature", key: "k", label: "", items: [item] }, 4, "days")).toBe("10 May 2024");
    expect(subtitleForRow({ type: "header", key: "k", label: "x" }, 4, "all")).toBe("");
    expect(subtitleForRow(undefined, 4, "all")).toBe("");
  });
});
