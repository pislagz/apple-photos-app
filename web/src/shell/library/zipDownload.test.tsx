import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ZipStatus from "./ZipStatus";
import { fetchZip, formatBytes, useZipDownload, ZipError } from "./zipDownload";

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

describe("useZipDownload", () => {
  it("saves the zip then goes idle; surfaces errors", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(streamOf([new Uint8Array(2)]), { status: 200 })));
    const { result } = renderHook(() => useZipDownload(1));
    await act(async () => {
      await result.current.start(["a", "b"]);
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase).toBe("idle");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 413 })));
    await act(async () => {
      await result.current.start(["a", "b"]);
    });
    await waitFor(() => expect(result.current.state.phase).toBe("error"));
    click.mockRestore();
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

  it("marks JPEG progress approximate and shows an indeterminate bar", () => {
    const { container } = render(
      <ZipStatus
        state={{ phase: "downloading", progress: { received: 512, total: 2048, approximate: true } }}
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
