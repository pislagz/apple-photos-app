import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../../testHelpers";
import { downloadAsset, downloadVersion, shareOrDownloadAssets } from "./download";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// P1.17 fix round: the server only writes an audit row when `/original`
// carries `?download=1`. These downloads are the explicit actions that must
// send it -- a plain viewer zoom never calls any of these functions.
describe("downloadVersion", () => {
  it("requests the original with the download marker", () => {
    let href = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      href = this.href;
    });

    downloadVersion(1, "a1", "original");

    expect(href).toContain("/api/libraries/1/original/a1");
    expect(href).toContain("download=1");
  });
});

describe("downloadAsset", () => {
  it("looks up the edited flag, then downloads with the marker", async () => {
    mockFetch(() => ({ has_edited: true }));
    let href = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      href = this.href;
    });

    await downloadAsset(1, "a1");

    expect(href).toContain("version=edited");
    expect(href).toContain("download=1");
  });
});

describe("shareOrDownloadAssets", () => {
  it("fetches files for the share sheet with the download marker", async () => {
    const fetchMock = mockFetch(() => new Response(new Blob(["x"]), { status: 200 }));
    vi.stubGlobal("navigator", {
      ...navigator,
      canShare: () => true,
      share: vi.fn(async () => {}),
    });

    await shareOrDownloadAssets(1, [{ id: "a1", filename: "a1.jpg" }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("download=1");
  });

  it("falls back to a marked download link when the Web Share API is unavailable", () => {
    vi.stubGlobal("navigator", { ...navigator, canShare: undefined, share: undefined });
    let href = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      href = this.href;
    });

    void shareOrDownloadAssets(1, [{ id: "a1", filename: "a1.jpg" }]);

    expect(href).toContain("download=1");
  });
});
