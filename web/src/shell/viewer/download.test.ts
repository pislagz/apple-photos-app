import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../../testHelpers";
import { canShareFiles, downloadAsset, downloadVersion, filenameFromDisposition, pickMime, shareAssets, shareFileName, shareOrDownloadAssets, shareReadyFiles } from "./download";

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

describe("shareFileName", () => {
  it("uses the original name, not the stored UUID name", () => {
    const item = { id: "u", filename: "ABC-123.heic", original_filename: "IMG_1234.HEIC" };
    expect(shareFileName(item, "image/heic")).toBe("IMG_1234.HEIC");
  });
  it("ends in .jpg when a HEIC was converted to JPEG", () => {
    const item = { id: "u", filename: "ABC.heic", original_filename: "IMG_1234.HEIC" };
    expect(shareFileName(item, "image/jpeg")).toBe("IMG_1234.jpg");
  });
  it("keeps .jpeg for a JPEG blob and a .jpeg name", () => {
    expect(shareFileName({ id: "u", filename: null, original_filename: "a.jpeg" }, "image/jpeg")).toBe("a.jpeg");
  });
  it("falls back to filename, then id, and strips path separators", () => {
    expect(shareFileName({ id: "u", filename: "x.png" }, "image/png")).toBe("x.png");
    expect(shareFileName({ id: "u", filename: null }, "")).toBe("u");
    expect(shareFileName({ id: "u", filename: null, original_filename: "a/b\\c.mov" }, "video/quicktime")).toBe("a_b_c.mov");
  });
});

describe("shareAssets", () => {
  it("shares files under their original filenames", async () => {
    mockFetch((url) =>
      url.includes("/assets/") ? { has_edited: false } : new Response("x", { status: 200 }),
    );
    const share = vi.fn(async (_data?: ShareData) => {});
    vi.stubGlobal("navigator", { ...navigator, canShare: () => true, share });
    await shareAssets(1, [{ id: "a1", filename: "IMG_0001.HEIC" }]);
    const arg = share.mock.calls[0][0] as { files: File[] };
    expect(arg.files.map((f) => f.name)).toEqual(["IMG_0001.HEIC"]);
  });

  it("uses the server's Content-Disposition name and a real MIME type", async () => {
    mockFetch((url) =>
      url.includes("/assets/")
        ? { has_edited: false }
        : new Response("x", {
            status: 200,
            headers: { "content-disposition": 'attachment; filename="IMG_0002.JPG"', "content-type": "application/octet-stream" },
          }),
    );
    const share = vi.fn(async (_data?: ShareData) => {});
    vi.stubGlobal("navigator", { ...navigator, canShare: () => true, share });
    await shareAssets(1, [{ id: "a2", filename: "other.heic" }]);
    const file = (share.mock.calls[0][0] as { files: File[] }).files[0];
    expect(file.name).toBe("IMG_0002.JPG");
    expect(file.type).toBe("image/jpeg");
  });
});

describe("share helpers", () => {
  it("pickMime falls back to the extension for blank/octet-stream types", () => {
    expect(pickMime("", "a.HEIC")).toBe("image/heic");
    expect(pickMime("application/octet-stream", "a.mov")).toBe("video/quicktime");
    expect(pickMime("image/png; charset=x", "a.jpg")).toBe("image/png");
  });

  it("parses plain and RFC 5987 filenames", () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition('attachment; filename="a b.jpg"')).toBe("a b.jpg");
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%C3%A9.jpg")).toBe("é.jpg");
  });

  it("canShareFiles is false in an insecure context", () => {
    vi.stubGlobal("navigator", { ...navigator, canShare: () => true, share: vi.fn() });
    expect(canShareFiles()).toBe(true);
    vi.stubGlobal("isSecureContext", false);
    expect(canShareFiles()).toBe(false);
  });
});
