import { describe, expect, it } from "vitest";
import {
  describeSelection,
  exportReducer,
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
  it("opens on the Originals choice with no size yet", () => {
    expect(run({ type: "open", items })).toEqual({ phase: "choosing", items, format: "original", bytes: null });
  });

  it("keeps format and size on the choice only", () => {
    const state = run({ type: "open", items }, { type: "size", bytes: 42 }, { type: "format", format: "jpeg" });
    expect(state).toMatchObject({ phase: "choosing", format: "jpeg", bytes: 42 });
    expect(exportReducer(IDLE, { type: "size", bytes: 1 })).toBe(IDLE);
  });

  it("walks choosing -> working -> ready, then close", () => {
    const file = new File(["x"], "a.heic");
    const working = run({ type: "open", items }, { type: "start", method: "share", fileCount: 2 }, { type: "progress", fileIndex: 1, received: 9 });
    expect(working).toMatchObject({ phase: "working", method: "share", fileIndex: 1, received: 9, fileCount: 2 });
    const ready = exportReducer(working, { type: "ready", files: [file] });
    expect(ready).toMatchObject({ phase: "ready", files: [file] });
    expect(exportReducer(ready, { type: "close" })).toBe(IDLE);
  });

  it("a stray start or progress outside its phase changes nothing", () => {
    expect(exportReducer(IDLE, { type: "start", method: "share", fileCount: 1 })).toBe(IDLE);
    const choosing = run({ type: "open", items });
    expect(exportReducer(choosing, { type: "progress", fileIndex: 1, received: 1 })).toBe(choosing);
  });

  it("an error or a block can go back to the choice with the same selection and format", () => {
    const working = run({ type: "open", items }, { type: "format", format: "jpeg" }, { type: "start", method: "folder", fileCount: 2 });
    const failed = exportReducer(working, { type: "error", message: "boom" });
    expect(failed).toMatchObject({ phase: "error", message: "boom", format: "jpeg" });
    expect(exportReducer(failed, { type: "back" })).toMatchObject({ phase: "choosing", items, format: "jpeg" });
    const blocked = exportReducer(run({ type: "open", items }), { type: "blocked", message: "big" });
    expect(blocked.phase).toBe("blocked");
  });

  it("done is terminal until closed", () => {
    const done = run({ type: "open", items }, { type: "start", method: "individual", fileCount: 2 }, { type: "done", method: "individual", saved: 2 });
    expect(done).toEqual({ phase: "done", method: "individual", saved: 2, folder: undefined });
    expect(exportReducer(done, { type: "back" })).toBe(IDLE);
  });
});

describe("limits", () => {
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
  it("describes count and approximate size", () => {
    expect(describeSelection(1, null)).toBe("1 item");
    expect(describeSelection(12, 5 * 1024 * 1024)).toBe("12 items · about 5.0 MB");
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
