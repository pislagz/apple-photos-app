import { describe, expect, it } from "vitest";
import type { AssetListItem } from "../../api";
import { buildRows, columnOf, verticalTarget } from "./rows";

function item(id: string, date: string): AssetListItem {
  return { id, filename: `${id}.jpg`, date, is_video: false, is_live_photo: false, favorite: false, width: 1, height: 1, duration: null };
}

describe("verticalTarget (#96)", () => {
  // Months view, 3 columns: May has 4 photos (rows of 3 + 1), April has 2.
  const items = [
    item("m1", "2024-05-04T10:00:00"),
    item("m2", "2024-05-03T10:00:00"),
    item("m3", "2024-05-02T10:00:00"),
    item("m4", "2024-05-01T10:00:00"),
    item("a1", "2024-04-02T10:00:00"),
    item("a2", "2024-04-01T10:00:00"),
  ];
  const rows = buildRows(items, "months", 3);

  it("moves to the cell visually below, across a date header, clamping the column", () => {
    expect(verticalTarget(rows, "m3", 1)).toBe("m4");
    expect(verticalTarget(rows, "m4", 1)).toBe("a1");
    expect(verticalTarget(rows, "m2", 1)).toBe("m4");
  });

  it("moves up across a header keeping the column", () => {
    expect(verticalTarget(rows, "a2", -1)).toBe("m4");
    expect(verticalTarget(rows, "a1", -1)).toBe("m4");
    expect(verticalTarget(rows, "m4", -1)).toBe("m1");
  });

  it("reports the top and bottom edges", () => {
    expect(verticalTarget(rows, "m1", -1)).toBeNull();
    expect(verticalTarget(rows, "a2", 1)).toBe("end");
    expect(verticalTarget(rows, "not-in-model", 1)).toBe("unknown");
    expect(verticalTarget(rows, "not-in-model", -1)).toBe("unknown");
  });
});

describe("buildRows days view (#104)", () => {
  it("gives a day with a single photo one full-width feature row and no grid row", () => {
    const rows = buildRows([item("a", "2024-05-02T10:00:00"), item("b", "2024-05-01T10:00:00")], "days", 3);
    expect(rows.map((row) => row.type)).toEqual(["feature", "feature"]);
  });
});

describe("verticalTarget goal column (D12)", () => {
  // Days, 3 columns: day 2 = lead + 4 (rows of 3 + 1); day 1 = lead + 3.
  const items = [
    item("a0", "2024-05-02T10:00:00"),
    ...["a1", "a2", "a3", "a4"].map((id, i) => item(id, `2024-05-02T0${9 - i}:00:00`)),
    item("b0", "2024-05-01T10:00:00"),
    ...["b1", "b2", "b3"].map((id, i) => item(id, `2024-05-01T0${9 - i}:00:00`)),
  ];
  const rows = buildRows(items, "days", 3);

  it("reports a cell's column, null for the lead photo", () => {
    expect(columnOf(rows, "a3")).toBe(2);
    expect(columnOf(rows, "a0")).toBeNull();
    expect(columnOf(rows, "zzz")).toBeNull();
  });

  it("uses the remembered column on the way out of a lead photo", () => {
    expect(verticalTarget(rows, "b0", 1)).toBe("b1");
    expect(verticalTarget(rows, "b0", 1, 2)).toBe("b3");
    expect(verticalTarget(rows, "b0", -1, 2)).toBe("a4");
    expect(verticalTarget(rows, "b0", -1, 0)).toBe("a4");
  });

  it("clamps the goal column on a short row", () => {
    expect(verticalTarget(rows, "a3", 1, 2)).toBe("a4");
  });
});
