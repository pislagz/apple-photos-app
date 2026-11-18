import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../../testHelpers";
import { downloadItem } from "./downloadItem";
import { setTransferFormat } from "./transferFormat";

const heic = { id: "a1", filename: "a1.heic", is_heic: true };
const live = { id: "a9", filename: "a9.heic", is_heic: true, is_live_photo: true };

let hrefs: string[];
beforeEach(() => {
  localStorage.clear();
  hrefs = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    hrefs.push(this.getAttribute("href") ?? "");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("downloadItem (Mac Download of one item)", () => {
  it("Automatic downloads a HEIC as JPEG, with the download marker and the edited version", async () => {
    mockFetch(() => ({ has_edited: true }));
    await downloadItem(1, heic);
    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]).toContain("/original/a1");
    expect(hrefs[0]).toContain("download=1");
    expect(hrefs[0]).toContain("version=edited");
    expect(hrefs[0]).toContain("format=jpeg");
  });

  it("Keep Originals downloads the stored file", async () => {
    setTransferFormat("original");
    mockFetch(() => ({ has_edited: false }));
    await downloadItem(1, heic);
    expect(hrefs[0]).not.toContain("format=jpeg");
  });

  it("Unmodified Original ignores the setting and the edit", async () => {
    mockFetch(() => ({ has_edited: true }));
    await downloadItem(1, heic, { unmodified: true });
    expect(hrefs[0]).toContain("/original/a1");
    expect(hrefs[0]).not.toContain("format=jpeg");
    expect(hrefs[0]).not.toContain("version=edited");
  });

  it("never converts a video or a file already stored as JPEG", async () => {
    mockFetch(() => ({ has_edited: false }));
    await downloadItem(1, { id: "v", filename: "v.mov", is_video: true });
    await downloadItem(1, { id: "j", filename: "j.jpg", is_heic: false });
    expect(hrefs.every((href) => !href.includes("format=jpeg"))).toBe(true);
  });

  it("a Live Photo brings its video with Keep Originals, not with Automatic", async () => {
    mockFetch(() => ({ has_edited: false }));
    await downloadItem(1, live);
    expect(hrefs).toHaveLength(1);
    setTransferFormat("original");
    await downloadItem(1, live);
    expect(hrefs).toHaveLength(3);
    expect(hrefs[2]).toContain("/livephoto/a9/video");
  });
});
