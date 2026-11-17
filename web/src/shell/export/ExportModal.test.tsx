import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../../testHelpers";
import ExportModal from "./ExportModal";
import type { ExportItem } from "./exportModel";
import { SHARE_MAX_BYTES } from "./exportModel";
import { useExport } from "./useExport";

const ITEMS: ExportItem[] = [
  { id: "a1", filename: "a1.heic", original_filename: "IMG_1.HEIC", is_heic: true },
  { id: "a2", filename: "a2.mov", original_filename: "IMG_2.MOV", is_video: true },
];

function Harness({ items = ITEMS }: { items?: ExportItem[] }) {
  const flow = useExport(1);
  return (
    <>
      <button type="button" onClick={() => flow.open(items)}>
        Start
      </button>
      <ExportModal flow={flow} />
    </>
  );
}

function stubServer(totalBytes = 2048, overrides: (url: string) => Response | undefined = () => undefined) {
  return mockFetch((url) => {
    const custom = overrides(url);
    if (custom) return custom;
    if (url.includes("selection-summary")) return { count: 2, photos: 1, videos: 1, total_bytes: totalBytes };
    if (/\/assets\/[^/?]+$/.test(url)) return { has_edited: false };
    if (url.includes("/original/")) {
      const id = /original\/([^?]+)/.exec(url)?.[1];
      const name = id === "a1" ? "IMG_1.HEIC" : "IMG_2.MOV";
      return new Response("bytes-" + id, { headers: { "content-type": "image/heic", "content-disposition": `attachment; filename="${name}"` } });
    }
    throw new Error(`unexpected ${url}`);
  });
}

function stubShare(share: (data: ShareData) => Promise<void> = async () => {}) {
  const spy = vi.fn(share);
  vi.stubGlobal("navigator", { ...navigator, share: spy, canShare: () => true });
  return spy;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Presses inside the sheet are ignored for half a second so the second tap of a double tap cannot hit it.
async function openChoice() {
  fireEvent.click(screen.getByText("Start"));
  const dialog = await screen.findByRole("dialog");
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(650);
    else await new Promise((resolve) => setTimeout(resolve, 650));
  });
  return dialog;
}

describe("export dialog", () => {
  it("asks Originals vs Compatible JPEG first, with count and size, and Cancel closes without sharing", async () => {
    stubServer(5 * 1024 * 1024);
    const share = stubShare();
    render(<Harness />);
    await openChoice();
    expect(screen.getByRole("radio", { name: /Originals/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Compatible JPEG/ })).not.toBeChecked();
    await waitFor(() => expect(screen.getByTestId("export-summary")).toHaveTextContent("2 items · about 5.0 MB"));
    expect(share).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(share).not.toHaveBeenCalled();
  });

  it("closes with the X, Escape, and a tap on the backdrop", async () => {
    stubServer();
    stubShare();
    render(<Harness />);
    await openChoice();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await openChoice();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await openChoice();
    fireEvent.mouseDown(screen.getByTestId("export-modal"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores a press inside the sheet right after it opens (second tap of a double tap)", async () => {
    stubServer();
    const share = stubShare();
    render(<Harness />);
    fireEvent.click(screen.getByText("Start"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /Share…/ }));
    fireEvent.mouseDown(screen.getByTestId("export-modal"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Originals/ })).toBeInTheDocument();
    expect(share).not.toHaveBeenCalled();
  });

  it("fetches after the choice, then one tap on 'Share N items' calls share() once with all files", async () => {
    const fetchMock = stubServer();
    const share = stubShare();
    render(<Harness />);
    await openChoice();
    fireEvent.click(screen.getByRole("button", { name: /Share…/ }));
    const confirm = await screen.findByRole("button", { name: "Share 2 items" });
    // Nothing was shared by the first click: the sheet needs this second tap.
    expect(share).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("download=1"))).toBe(true);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(share).toHaveBeenCalledTimes(1);
    const files = share.mock.calls[0][0].files as File[];
    expect(files.map((file) => file.name).sort()).toEqual(["IMG_1.HEIC", "IMG_2.MOV"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Compatible JPEG asks the server for JPEG renditions of HEIC photos only", async () => {
    const fetchMock = stubServer();
    stubShare();
    render(<Harness />);
    await openChoice();
    fireEvent.click(screen.getByRole("radio", { name: /Compatible JPEG/ }));
    fireEvent.click(screen.getByRole("button", { name: /Share…/ }));
    await screen.findByRole("button", { name: "Share 2 items" });
    const urls = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/original/"));
    expect(urls.find((url) => url.includes("/a1"))).toContain("format=jpeg");
    expect(urls.find((url) => url.includes("/a2"))).not.toContain("format=jpeg");
  });

  it("a dismissed share sheet is silent: no error, still closable", async () => {
    stubServer();
    const share = stubShare(() => Promise.reject(new DOMException("cancelled", "AbortError")));
    render(<Harness />);
    await openChoice();
    fireEvent.click(screen.getByRole("button", { name: /Share…/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Share 2 items" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuses an over-limit selection with a message and no silent split", async () => {
    stubServer(SHARE_MAX_BYTES + 10);
    const share = stubShare();
    render(<Harness />);
    await openChoice();
    await waitFor(() => expect(screen.getByRole("note")).toHaveTextContent(/too large for one share sheet/));
    expect(screen.getByRole("button", { name: /Share…/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Download Individually/ })).toBeEnabled();
    expect(share).not.toHaveBeenCalled();
  });

  it("stops when the real bytes pass the share limit", async () => {
    const big = new Uint8Array(SHARE_MAX_BYTES + 1);
    stubServer(1, (url) => (url.includes("/original/a1") ? new Response(big, { headers: { "content-type": "image/jpeg" } }) : undefined));
    const share = stubShare();
    render(<Harness />);
    await openChoice();
    fireEvent.click(screen.getByRole("button", { name: /Share…/ }));
    await screen.findByText("Too large to share");
    expect(share).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Choose Another Method" }));
    expect(screen.getByRole("radio", { name: /Originals/ })).toBeInTheDocument();
  });

  it("shows a network failure with Try Again, and Try Again returns to the choice", async () => {
    stubServer(10, (url) => {
      if (url.includes("/original/")) throw new TypeError("Failed to fetch");
      return undefined;
    });
    stubShare();
    render(<Harness />);
    await openChoice();
    fireEvent.click(screen.getByRole("button", { name: /Share…/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/connection dropped/);
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(screen.getByRole("radio", { name: /Originals/ })).toBeInTheDocument();
  });

  it("allows one export at a time", async () => {
    stubServer();
    stubShare();
    render(
      <>
        <Harness />
        <Harness />
      </>,
    );
    fireEvent.click(screen.getAllByText("Start")[0]);
    fireEvent.click(screen.getAllByText("Start")[1]);
    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
  });

  it("downloads individually, in order, with de-duplicated names, and releases object URLs", async () => {
    stubServer(10, (url) =>
      url.includes("/original/") ? new Response("x", { headers: { "content-type": "image/heic", "content-disposition": 'attachment; filename="IMG_1.HEIC"' } }) : undefined,
    );
    vi.stubGlobal("navigator", { ...navigator, share: undefined, canShare: undefined });
    const created: string[] = [];
    const revoked: string[] = [];
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: () => {
        const url = `blob:test/${created.length}`;
        created.push(url);
        return url;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    }));
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Harness />);
      await openChoice();
      expect(screen.queryByRole("button", { name: /Share…/ })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Download Individually/ }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(names).toEqual(["IMG_1.HEIC", "IMG_1 (1).HEIC"]);
      fireEvent.click(await screen.findByRole("button", { name: "Done" }));
      expect(revoked).toEqual(created);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves to a chosen folder where showDirectoryPicker exists, never overwriting", async () => {
    stubServer(10, (url) =>
      url.includes("/original/") ? new Response("hello", { headers: { "content-type": "image/heic", "content-disposition": 'attachment; filename="IMG_1.HEIC"' } }) : undefined,
    );
    stubShare();
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
    render(<Harness />);
    await openChoice();
    fireEvent.click(screen.getByRole("button", { name: /Save to Folder…/ }));
    expect(await screen.findByText(/Saved 2 files to “Exports”/)).toBeInTheDocument();
    expect(picker).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(Object.keys(written)).toEqual(["IMG_1 (1).HEIC", "IMG_1 (2).HEIC"]);
  });

  it("cancelling the folder picker returns to the choice without an error", async () => {
    stubServer();
    stubShare();
    vi.stubGlobal("showDirectoryPicker", vi.fn(async () => Promise.reject(new DOMException("x", "AbortError"))));
    render(<Harness />);
    await openChoice();
    fireEvent.click(screen.getByRole("button", { name: /Save to Folder…/ }));
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("radio", { name: /Originals/ })).toBeInTheDocument();
  });

  it("Live Photos add their paired video when exporting originals", async () => {
    const fetchMock = stubServer(10, (url) =>
      url.includes("/livephoto/") ? new Response("mov", { headers: { "content-type": "video/quicktime", "content-disposition": 'attachment; filename="IMG_9.MOV"' } }) : undefined,
    );
    stubShare();
    render(<Harness items={[{ id: "a9", filename: "a9.heic", original_filename: "IMG_9.HEIC", is_live_photo: true, is_heic: true }]} />);
    await openChoice();
    fireEvent.click(screen.getByRole("button", { name: /Share…/ }));
    await screen.findByRole("button", { name: "Share 1 item" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/livephoto/a9/video"))).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("2 files are ready");
  });
});
