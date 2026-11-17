import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../../testHelpers";
import type { ExportItem } from "./exportModel";
import { SHARE_MAX_BYTES, SHARE_MAX_FILES } from "./exportModel";
import { setTransferFormat } from "./transferFormat";
import TransferHud, { HUD_DELAY_MS } from "./TransferHud";
import { useExport } from "./useExport";

const ITEMS: ExportItem[] = [
  { id: "a1", filename: "a1.heic", original_filename: "IMG_1.HEIC", is_heic: true },
  { id: "a2", filename: "a2.mov", original_filename: "IMG_2.MOV", is_video: true },
];

function Harness({ items = ITEMS, layout = "phone" }: { items?: ExportItem[]; layout?: "phone" | "desktop" }) {
  const flow = useExport(1);
  return (
    <>
      <button type="button" onClick={() => void flow.share(items)}>
        Start
      </button>
      <button type="button" onClick={() => void flow.exportToFolder(items)}>
        Folder
      </button>
      <TransferHud flow={flow} layout={layout} />
    </>
  );
}

function stubServer(totalBytes = 2048, overrides: (url: string) => Response | undefined = () => undefined) {
  return mockFetch((url) => {
    const custom = overrides(url);
    if (custom) return custom;
    if (url.includes("selection-summary")) return { count: 2, photos: 1, videos: 1, total_bytes: totalBytes };
    if (/\/assets\/[^/?]+$/.test(url)) return { has_edited: false };
    if (url.includes("/zip/ticket")) return { ticket: "t1", total_bytes: 10, expires_in: 60, job: null };
    if (url.includes("/original/")) {
      const id = /original\/([^?]+)/.exec(url)?.[1];
      const name = id === "a1" ? "IMG_1.HEIC" : "IMG_2.MOV";
      return new Response("bytes-" + id, { headers: { "content-type": "image/heic", "content-disposition": `attachment; filename="${name}"` } });
    }
    throw new Error(`unexpected ${url}`);
  });
}

function stubShare(share: (data: ShareData) => Promise<void> = async () => {}, extra: object = {}) {
  const spy = vi.fn(share);
  vi.stubGlobal("navigator", { ...navigator, share: spy, canShare: () => true, ...extra });
  return spy;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("iPhone share, no HUD when it is fast", () => {
  it("one tap: fetches and calls share() with the file, never showing the HUD", async () => {
    stubServer();
    const share = stubShare();
    render(<Harness items={[ITEMS[0]]} />);
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("transfer-hud")).toBeNull();
    expect((share.mock.calls[0][0].files as File[]).map((file) => file.name)).toEqual(["IMG_1.HEIC"]);
  });

  it("Automatic asks for JPEG of HEIC photos only; Keep Originals asks for the stored files", async () => {
    const fetchMock = stubServer();
    stubShare();
    render(<Harness />);
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/original/"))).toHaveLength(2));
    const urls = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/original/"));
    expect(urls.find((url) => url.includes("/a1"))).toContain("format=jpeg");
    expect(urls.find((url) => url.includes("/a2"))).not.toContain("format=jpeg");
  });

  it("Keep Originals adds the Live Photo video", async () => {
    setTransferFormat("original");
    const fetchMock = stubServer(10, (url) =>
      url.includes("/livephoto/") ? new Response("mov", { headers: { "content-type": "video/quicktime", "content-disposition": 'attachment; filename="IMG_9.MOV"' } }) : undefined,
    );
    const share = stubShare();
    render(<Harness items={[{ id: "a9", filename: "a9.heic", original_filename: "IMG_9.HEIC", is_live_photo: true, is_heic: true }]} />);
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/livephoto/a9/video"))).toBe(true);
    expect((share.mock.calls[0][0].files as File[]).length).toBe(2);
  });
});

describe("iPhone HUD", () => {
  it("shows Preparing with a ring and Cancel only after a short delay, and Cancel stops it", async () => {
    // A body that stays open until released, so the export is "still preparing".
    let release: () => void = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        release = () => controller.close();
      },
    });
    stubServer(10, (url) => (url.includes("/original/a1") ? new Response(body, { headers: { "content-type": "image/jpeg" } }) : undefined));
    const share = stubShare();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Harness />);
      fireEvent.click(screen.getByText("Start"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HUD_DELAY_MS - 100);
      });
      expect(screen.queryByTestId("transfer-hud")).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(screen.getByRole("status")).toHaveTextContent("Preparing 2 Items…");
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByTestId("transfer-hud")).toBeNull();
      release();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(share).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("when the tap expired, the HUD turns into one 'Share 2 Items' button that shares once", async () => {
    stubServer();
    const share = stubShare(async () => {}, { userActivation: { isActive: false } });
    render(<Harness />);
    fireEvent.click(screen.getByText("Start"));
    const confirm = await screen.findByRole("button", { name: "Share 2 Items" });
    expect(share).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(share).toHaveBeenCalledTimes(1);
    expect((share.mock.calls[0][0].files as File[]).map((file) => file.name).sort()).toEqual(["IMG_1.HEIC", "IMG_2.MOV"]);
    await waitFor(() => expect(screen.queryByTestId("transfer-hud")).toBeNull());
  });

  it("a browser that refuses without a fresh tap falls back to the same button", async () => {
    stubServer();
    const share = stubShare(() => Promise.reject(new DOMException("needs a tap", "NotAllowedError")));
    render(<Harness />);
    fireEvent.click(screen.getByText("Start"));
    expect(await screen.findByRole("button", { name: "Share 2 Items" })).toBeInTheDocument();
    expect(share).toHaveBeenCalledTimes(1);
  });

  it("a dismissed share sheet just ends, with no error", async () => {
    stubServer();
    const share = stubShare(() => Promise.reject(new DOMException("cancelled", "AbortError")));
    render(<Harness />);
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("over the file limit offers Save as ZIP to Files, which buys a ZIP ticket", async () => {
    const fetchMock = stubServer();
    const share = stubShare();
    const many = Array.from({ length: SHARE_MAX_FILES + 1 }, (_, i) => ({ id: `m${i}`, filename: `m${i}.jpg` }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<Harness items={many} />);
    fireEvent.click(screen.getByText("Start"));
    expect(await screen.findByText("Too Much to Share")).toBeInTheDocument();
    expect(share).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save as ZIP to Files" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/zip/ticket"))).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("transfer-hud")).toBeNull());
  });

  it("stops when the real bytes pass the share limit and offers the ZIP", async () => {
    const big = new Uint8Array(SHARE_MAX_BYTES + 1);
    stubServer(1, (url) => (url.includes("/original/a1") ? new Response(big, { headers: { "content-type": "image/jpeg" } }) : undefined));
    const share = stubShare();
    render(<Harness />);
    fireEvent.click(screen.getByText("Start"));
    expect(await screen.findByText("Too Much to Share")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as ZIP to Files" })).toBeInTheDocument();
    expect(share).not.toHaveBeenCalled();
  });

  it("a network failure shows the error state with Try Again, which runs it again", async () => {
    let fail = true;
    const fetchMock = stubServer(10, (url) => {
      if (url.includes("/original/") && fail) throw new TypeError("Failed to fetch");
      return undefined;
    });
    const share = stubShare();
    render(<Harness items={[ITEMS[0]]} />);
    fireEvent.click(screen.getByText("Start"));
    expect(await screen.findByText(/connection dropped/)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalled();
  });

  it("allows one export at a time", async () => {
    stubServer();
    const share = stubShare(async () => {}, { userActivation: { isActive: false } });
    render(
      <>
        <Harness />
        <Harness />
      </>,
    );
    fireEvent.click(screen.getAllByText("Start")[0]);
    fireEvent.click(screen.getAllByText("Start")[1]);
    expect(await screen.findAllByRole("alertdialog")).toHaveLength(1);
    expect(share).not.toHaveBeenCalled();
  });

  it("Escape closes a waiting HUD", async () => {
    stubServer();
    stubShare(async () => {}, { userActivation: { isActive: false } });
    render(<Harness />);
    fireEvent.click(screen.getByText("Start"));
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("transfer-hud")).toBeNull();
  });
});

describe("Mac layout", () => {
  it("shows nothing while preparing (the toolbar ring does), and a decision panel when needed", async () => {
    stubServer();
    stubShare(async () => {}, { userActivation: { isActive: false } });
    render(<Harness layout="desktop" />);
    fireEvent.click(screen.getByText("Start"));
    const panel = await screen.findByRole("alertdialog");
    expect(panel.closest(".transfer-hud--desktop")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Share 2 Items" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("blocked share offers 'Download as ZIP'", async () => {
    stubServer();
    stubShare();
    const many = Array.from({ length: SHARE_MAX_FILES + 1 }, (_, i) => ({ id: `m${i}`, filename: `m${i}.jpg` }));
    render(<Harness layout="desktop" items={many} />);
    fireEvent.click(screen.getByText("Start"));
    expect(await screen.findByRole("button", { name: "Download as ZIP" })).toBeInTheDocument();
  });

  it("saves to a chosen folder where showDirectoryPicker exists, never overwriting", async () => {
    setTransferFormat("original");
    stubServer(10, (url) =>
      url.includes("/original/") ? new Response("hello", { headers: { "content-type": "image/heic", "content-disposition": 'attachment; filename="IMG_1.HEIC"' } }) : undefined,
    );
    const written: Record<string, string[]> = {};
    const existing = new Set(["IMG_1.HEIC"]);
    const directory = {
      name: "Exports",
      getFileHandle: vi.fn(async (name: string, options?: { create?: boolean }) => {
        if (!options?.create) {
          if (existing.has(name)) return {};
          throw new DOMException("missing", "NotFoundError");
        }
        written[name] = [];
        return {
          createWritable: async () => ({
            write: async (chunk: Uint8Array) => void written[name].push(new TextDecoder().decode(chunk)),
            close: async () => {},
          }),
        };
      }),
    };
    const picker = vi.fn(async () => directory);
    vi.stubGlobal("showDirectoryPicker", picker);
    render(<Harness layout="desktop" />);
    fireEvent.click(screen.getByText("Folder"));
    expect(await screen.findByText(/2 files saved to “Exports”/)).toBeInTheDocument();
    expect(picker).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(Object.keys(written)).toEqual(["IMG_1 (1).HEIC", "IMG_1 (2).HEIC"]);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByTestId("transfer-hud")).toBeNull();
  });

  it("cancelling the folder picker ends quietly", async () => {
    stubServer();
    vi.stubGlobal("showDirectoryPicker", vi.fn(async () => Promise.reject(new DOMException("x", "AbortError"))));
    render(<Harness layout="desktop" />);
    fireEvent.click(screen.getByText("Folder"));
    await act(async () => {});
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
