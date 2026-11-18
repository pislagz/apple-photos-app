import { describe, expect, it } from "vitest";
import {
  countLabel,
  exportReducer,
  formatFor,
  IDLE,
  SHARE_MAX_BYTES,
  SHARE_MAX_FILES,
  shareBlockReason,
  uniqueName,
  type ExportItem,
  type ExportState,
} from "./exportModel";

const items: ExportItem[] = [{ id: "a", filename: "a.heic" }, { id: "b", filename: "b.mov", is_video: true }];

function run(...actions: Parameters<typeof exportReducer>[1][]): ExportState {
  return actions.reduce(exportReducer, IDLE as ExportState);
}

describe("exportReducer", () => {
  it("walks start -> progress -> ready, then close", () => {
    const file = new File(["x"], "a.heic");
    const working = run({ type: "start", method: "share", items, fileCount: 2 }, { type: "progress", fileIndex: 1, received: 9 });
    expect(working).toMatchObject({ phase: "working", method: "share", fileIndex: 1, received: 9, fileCount: 2 });
    const ready = exportReducer(working, { type: "ready", items, files: [file] });
    expect(ready).toMatchObject({ phase: "ready", files: [file] });
    expect(exportReducer(ready, { type: "hint", hint: "Tap again" })).toMatchObject({ hint: "Tap again" });
    expect(exportReducer(ready, { type: "close" })).toBe(IDLE);
  });

  it("progress and hint outside their phase change nothing", () => {
    expect(exportReducer(IDLE, { type: "progress", fileIndex: 1, received: 1 })).toBe(IDLE);
    expect(exportReducer(IDLE, { type: "hint", hint: "x" })).toBe(IDLE);
  });

  it("keeps the items on blocked and error so Try Again and Save as ZIP have them", () => {
    expect(run({ type: "blocked", items, message: "Too many" })).toEqual({ phase: "blocked", items, message: "Too many" });
    expect(run({ type: "error", method: "folder", items, message: "Disk full" })).toEqual({ phase: "error", method: "folder", items, message: "Disk full" });
  });

  it("done keeps the folder name", () => {
    expect(run({ type: "done", method: "folder", saved: 2, folder: "Trip" })).toEqual({ phase: "done", method: "folder", saved: 2, folder: "Trip" });
  });
});

describe("format and limits", () => {
  it("Automatic is JPEG, Keep Originals is as stored", () => {
    expect(formatFor("automatic")).toBe("jpeg");
    expect(formatFor("original")).toBe("original");
  });
  it("blocks the share sheet for too many files or too many originals bytes", () => {
    expect(shareBlockReason(3, 1000, "original")).toBeNull();
    expect(shareBlockReason(SHARE_MAX_FILES + 1, null, "original")).toMatch(/too many/);
    expect(shareBlockReason(3, SHARE_MAX_BYTES + 1, "original")).toMatch(/too large/);
  });
  it("does not trust the originals size for JPEG (checked while fetching)", () => {
    expect(shareBlockReason(3, SHARE_MAX_BYTES * 5, "jpeg")).toBeNull();
  });
});

describe("text and names", () => {
  it("counts items", () => {
    expect(countLabel(1)).toBe("1 Item");
    expect(countLabel(3)).toBe("3 Items");
  });
  it("de-duplicates names case-insensitively and keeps the extension", () => {
    const taken = new Set<string>();
    expect(uniqueName("IMG_1.HEIC", taken)).toBe("IMG_1.HEIC");
    expect(uniqueName("img_1.heic", taken)).toBe("img_1 (1).heic");
    expect(uniqueName("IMG_1.HEIC", taken)).toBe("IMG_1 (2).HEIC");
    expect(uniqueName("noext", taken)).toBe("noext");
    expect(uniqueName("noext", taken)).toBe("noext (1)");
  });
});
