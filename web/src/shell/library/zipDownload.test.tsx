import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HeicFallbackModal from "./HeicFallbackModal";
import ZipStatus from "./ZipStatus";
import {
  fetchZip,
  formatBytes,
  isIosDevice,
  selectionHasHeic,
  STREAM_TO_DISK_BYTES,
  useZipDownload,
  waitForUnconverted,
  ZipError,
} from "./zipDownload";

afterEach(() => vi.unstubAllGlobals());

function streamOf(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(10)).toBe("10 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });
});

describe("fetchZip", () => {
  it("POSTs the selection and reports progress against X-Zip-Total-Bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(streamOf([new Uint8Array(3), new Uint8Array(4)]), {
        status: 200,
        headers: { "X-Zip-Total-Bytes": "7" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const seen: Array<[number, number | null]> = [];
    const blob = await fetchZip(1, ["a", "b"], "jpeg", (p) => seen.push([p.received, p.total]));
    expect(blob.size).toBe(7);
    expect(seen).toEqual([
      [0, 7],
      [3, 7],
      [7, 7],
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/libraries/1/zip");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ asset_ids: ["a", "b"], format: "jpeg" });
  });

  it("turns a 413 into a clear ZipError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Selection is 9 bytes; the zip limit is 5 bytes." }), { status: 413 })),
    );
    await expect(fetchZip(1, ["a"], "native", () => {})).rejects.toMatchObject({
      status: 413,
      message: expect.stringContaining("Too large"),
    });
    await expect(fetchZip(1, ["a"], "native", () => {})).rejects.toBeInstanceOf(ZipError);
  });
});

// Routes the ticket POST and the in-page zip POST like the server would.
function zipFetch(options: { total?: number; job?: string | null; zip?: () => Response; report?: unknown[] } = {}) {
  const { total = 10, job = null, zip, report = [] } = options;
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/zip/ticket")) {
      return new Response(JSON.stringify({ ticket: "tk1", total_bytes: total, expires_in: 60, job }), { status: 200 });
    }
    if (path.endsWith("/zip")) return zip ? zip() : new Response(streamOf([new Uint8Array(2)]), { status: 200 });
    if (path.includes("/zip/report")) {
      const next = report.shift();
      return new Response(JSON.stringify(next ?? { done: true, unconverted: [] }), { status: 200 });
    }
    throw new Error(`unexpected ${path} ${init?.method}`);
  });
}

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, "userAgent", { value, configurable: true });
}
const DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) Chrome/120";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

describe("useZipDownload", () => {
  afterEach(() => setUserAgent(DESKTOP_UA));

  it("small selection on desktop: in-page progress and Blob save, then idle; surfaces errors", async () => {
    setUserAgent(DESKTOP_UA);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const fetchMock = zipFetch({ total: 1024 });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useZipDownload(1));
    await act(async () => {
      await result.current.start(["a", "b"]);
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase).toBe("idle");
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/libraries/1/zip/ticket", "/api/libraries/1/zip"]);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 413 })));
    await act(async () => {
      await result.current.start(["a", "b"]);
    });
    await waitFor(() => expect(result.current.state.phase).toBe("error"));
    click.mockRestore();
  });

  it("over ~500 MB on desktop: a plain navigation to the zip endpoint, no in-page buffering (D47)", async () => {
    setUserAgent(DESKTOP_UA);
    const hrefs: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      hrefs.push(this.getAttribute("href") ?? "");
    });
    const fetchMock = zipFetch({ total: STREAM_TO_DISK_BYTES + 1 });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useZipDownload(7));
    await act(async () => {
      await result.current.start(["a", "b"]);
    });
    expect(hrefs).toEqual(["/api/libraries/7/zip/download?ticket=tk1"]);
    expect(result.current.state.phase).toBe("started");
    // The zip itself was never fetched by script (that would buffer it in memory).
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/libraries/7/zip/ticket"]);
    click.mockRestore();
  });

  it("on iPhone/iPad every zip is a browser download, whatever its size (D47)", async () => {
    setUserAgent(IPHONE_UA);
    const hrefs: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      hrefs.push(this.getAttribute("href") ?? "");
    });
    const fetchMock = zipFetch({ total: 1024 });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useZipDownload(1));
    await act(async () => {
      await result.current.start(["a", "b"]);
    });
    expect(hrefs).toEqual(["/api/libraries/1/zip/download?ticket=tk1"]);
    expect(fetchMock.mock.calls).toHaveLength(1);
    click.mockRestore();
  });

  it("iPadOS (desktop user agent, touch screen) counts as iOS", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15");
    Object.defineProperty(window.navigator, "maxTouchPoints", { value: 5, configurable: true });
    expect(isIosDevice()).toBe(true);
    Object.defineProperty(window.navigator, "maxTouchPoints", { value: 0, configurable: true });
    expect(isIosDevice()).toBe(false);
  });

  it("a refused selection (413) never navigates", async () => {
    setUserAgent(IPHONE_UA);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Selection is 9 bytes; the zip limit is 5 bytes." }), { status: 413 })));
    const { result } = renderHook(() => useZipDownload(1));
    await act(async () => {
      await result.current.start(["a"]);
    });
    expect(click).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ phase: "error", message: expect.stringContaining("Too large") });
    click.mockRestore();
  });
});

describe("HEIC fallback report (D50)", () => {
  afterEach(() => setUserAgent(DESKTOP_UA));

  it("in-page zip: reads the job id, waits for the report, offers the files that stayed HEIC", async () => {
    setUserAgent(DESKTOP_UA);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const fetchMock = zipFetch({
      job: "j1",
      zip: () => new Response(streamOf([new Uint8Array(2)]), { status: 200, headers: { "X-Zip-Job": "j1" } }),
      report: [{ done: true, unconverted: [{ id: "a", name: "IMG_1.HEIC" }, { id: "c", name: "IMG_3.HEIC" }] }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useZipDownload(1));
    act(() => result.current.setJpeg(true));
    await act(async () => {
      await result.current.start(["a", "b", "c"]);
    });
    await waitFor(() => expect(result.current.heicFallback).toHaveLength(2));
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe("/api/libraries/1/zip/report?job=j1");

    // "Download originals of these": a native zip of just those two ids.
    fetchMock.mockClear();
    await act(async () => {
      result.current.downloadOriginals();
    });
    const bodies = fetchMock.mock.calls
      .filter((c) => String(c[0]).endsWith("/zip/ticket") || String(c[0]).endsWith("/zip"))
      .map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies[0]).toEqual({ asset_ids: ["a", "c"], format: "native" });
    expect(result.current.heicFallback).toBeNull();
    click.mockRestore();
  });

  it("disk download: polls the report until the stream is done", async () => {
    setUserAgent(IPHONE_UA);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const fetchMock = zipFetch({
      job: "j2",
      report: [{ done: false, unconverted: [] }, { done: true, unconverted: [{ id: "a", name: "IMG_1.HEIC" }] }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useZipDownload(1));
    act(() => result.current.setJpeg(true));
    await act(async () => {
      await result.current.start(["a"]);
    });
    await waitFor(() => expect(result.current.heicFallback).toEqual([{ id: "a", name: "IMG_1.HEIC" }]), { timeout: 6000 });
    click.mockRestore();
  }, 10000);

  it("nothing to show when every file converted", async () => {
    const fetchMock = zipFetch({ report: [{ done: true, unconverted: [] }] });
    vi.stubGlobal("fetch", fetchMock);
    await expect(waitForUnconverted(1, "j", { intervalMs: 1 })).resolves.toEqual([]);
  });

  it("modal text, buttons and Escape", () => {
    const onDownload = vi.fn();
    const onClose = vi.fn();
    render(
      <HeicFallbackModal
        files={[{ id: "a", name: "a.HEIC" }, { id: "b", name: "b.HEIC" }, { id: "c", name: "c.HEIC" }]}
        onDownloadOriginals={onDownload}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("These 3 files stayed HEIC: a.HEIC, b.HEIC, c.HEIC");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "OK" }));
    fireEvent.click(screen.getByRole("button", { name: "Download originals of these" }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ZipStatus says a browser download started", () => {
    render(<ZipStatus state={{ phase: "started" }} jpeg={false} onJpegChange={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Download started");
  });
});

describe("zip honesty and limits (#198)", () => {
  it("maps a 422 for more than 5000 ids to a clear message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: [{ type: "too_long" }] }), { status: 422, statusText: "Unprocessable Entity" })),
    );
    const ids = Array.from({ length: 5001 }, (_, i) => `a${i}`);
    await expect(fetchZip(1, ids, "native", () => {})).rejects.toMatchObject({
      status: 422,
      message: "Select at most 5000 items",
    });
  });

  it("marks JPEG progress total unknown and shows an indeterminate bar", () => {
    const { container } = render(
      <ZipStatus
        state={{ phase: "downloading", progress: { received: 512, total: 2048, totalUnknown: true } }}
        jpeg
        onJpegChange={() => {}}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("512 B");
    expect(container.querySelector("progress")?.hasAttribute("value")).toBe(false);
  });

  it("says the total is about the size for native zips", () => {
    render(
      <ZipStatus state={{ phase: "downloading", progress: { received: 512, total: 2048 } }} jpeg={false} onJpegChange={() => {}} />,
    );
    expect(screen.getByRole("status").textContent).toBe("512 B of about 2.0 KB");
  });
});

describe("ZipStatus", () => {
  it("shows progress, and an alert for errors", () => {
    const { rerender } = render(
      <ZipStatus state={{ phase: "downloading", progress: { received: 512, total: 2048 } }} jpeg={false} onJpegChange={() => {}} />,
    );
    expect(screen.getByRole("status").textContent).toBe("512 B of about 2.0 KB");
    rerender(<ZipStatus state={{ phase: "error", message: "Too large" }} jpeg onJpegChange={() => {}} />);
    expect(screen.getByRole("alert").textContent).toBe("Too large");
    expect((screen.getByLabelText("HEIC as JPEG") as HTMLInputElement).checked).toBe(true);
  });
});

describe("HEIC as JPEG only for a selection with a HEIC (#254)", () => {
  const items = [
    { id: "heic", filename: "IMG_1.JPG", is_heic: true },
    { id: "jpeg", filename: "IMG_2.HEIC", is_heic: false },
    { id: "png", filename: "IMG_3.png", is_heic: false },
    { id: "old-server", filename: "IMG_4.heif" },
  ];

  it("follows is_heic, not the filename", () => {
    expect(selectionHasHeic(items, ["jpeg", "png"])).toBe(false);
    expect(selectionHasHeic(items, ["png", "heic"])).toBe(true);
  });

  it("falls back to the extension when the server sends no is_heic", () => {
    expect(selectionHasHeic(items, ["old-server"])).toBe(true);
    expect(selectionHasHeic([{ id: "x", filename: "a.jpg" }], ["x"])).toBe(false);
  });

  it("assumes a selected item it hasn't loaded might be HEIC", () => {
    expect(selectionHasHeic(items, ["png", "not-loaded"])).toBe(true);
  });

  it("ZipStatus hides the checkbox when told the selection has no HEIC", () => {
    render(<ZipStatus state={{ phase: "idle" }} jpeg={false} onJpegChange={() => {}} showHeicOption={false} />);
    expect(screen.queryByLabelText("HEIC as JPEG")).toBeNull();
  });
});
