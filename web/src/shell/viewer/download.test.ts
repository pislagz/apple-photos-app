import { afterEach, describe, expect, it, vi } from "vitest";
import { filenameFromDisposition, pickMime, shareFileName, triggerDownload } from "./download";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("triggerDownload", () => {
  it("clicks one download link", () => {
    let href = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      href = this.href;
    });
    triggerDownload("/api/libraries/1/original/a1?download=1");
    expect(href).toContain("/api/libraries/1/original/a1?download=1");
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
});
