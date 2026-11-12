import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../../testHelpers";
import { downloadAsset, downloadVersion, shareOrDownloadAssets, shareReadyFiles } from "./download";

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
    const fetchMock = mockFetch((url) =>
      url.includes("/assets/") ? { has_edited: false } : new Response("x", { status: 200 }),
    );
    vi.stubGlobal("navigator", {
      ...navigator,
      canShare: () => true,
      share: vi.fn(async () => {}),
    });

    await shareOrDownloadAssets(1, [{ id: "a1", filename: "a1.jpg" }]);

    const fileFetch = fetchMock.mock.calls.find((call) => String(call[0]).includes("download=1"));
    expect(fileFetch).toBeDefined();
  });

  it("falls back to a marked download link when the Web Share API is unavailable", async () => {
    mockFetch(() => ({ has_edited: false }));
    vi.stubGlobal("navigator", { ...navigator, canShare: undefined, share: undefined });
    let href = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      href = this.href;
    });

    await shareOrDownloadAssets(1, [{ id: "a1", filename: "a1.jpg" }]);

    expect(href).toContain("download=1");
  });

  it("shares every selected file in one share() call", async () => {
    mockFetch((url) =>
      url.includes("/assets/") ? { has_edited: false } : new Response("x", { status: 200 }),
    );
    const share = vi.fn(async (_data: { files: File[] }) => {});
    vi.stubGlobal("navigator", { ...navigator, canShare: () => true, share });
    const items = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, filename: `a${i}.jpg` }));

    const outcome = await shareOrDownloadAssets(1, items);

    expect(outcome.status).toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0]![0].files.map((f: File) => f.name)).toEqual(items.map((i) => i.filename));
  });

  it("does not fall back to download links when share() is blocked; hands the files back", async () => {
    mockFetch((url) =>
      url.includes("/assets/") ? { has_edited: false } : new Response("x", { status: 200 }),
    );
    const share = vi.fn(async (_data: { files: File[] }): Promise<void> => {
      throw new DOMException("expired", "NotAllowedError");
    });
    vi.stubGlobal("navigator", { ...navigator, canShare: () => true, share });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const outcome = await shareOrDownloadAssets(1, [
      { id: "a1", filename: "a1.jpg" },
      { id: "a2", filename: "a2.jpg" },
    ]);

    expect(click).not.toHaveBeenCalled();
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") return;
    expect(outcome.files).toHaveLength(2);
    share.mockImplementation(async () => {});
    expect((await shareReadyFiles(outcome.files)).status).toBe("shared");
  });

  it("treats a dismissed share sheet as cancelled, not a download", async () => {
    mockFetch((url) =>
      url.includes("/assets/") ? { has_edited: false } : new Response("x", { status: 200 }),
    );
    vi.stubGlobal("navigator", {
      ...navigator,
      canShare: () => true,
      share: vi.fn(async () => {
        throw new DOMException("dismissed", "AbortError");
      }),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    expect((await shareOrDownloadAssets(1, [{ id: "a1", filename: "a1.jpg" }])).status).toBe("cancelled");
    expect(click).not.toHaveBeenCalled();
  });
});
