import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetListItem } from "../../api";

export interface ZipProgress {
  received: number;
  // From X-Zip-Total-Bytes (sum of the stored file sizes); null if absent.
  total: number | null;
  // HEIC->JPEG conversion changes the sizes, so the total is only a guess.
  totalUnknown?: boolean;
}

// The server's cap on ids per zip request; more answers 422.
export const MAX_ZIP_ITEMS = 5000;

export class ZipError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

// #254: "HEIC as JPEG" only means something when the selection has a HEIC.
// A selected id that isn't in `items` (not loaded here) or an item from a
// server that doesn't send `is_heic` counts as "might be": showing the option
// once too often is harmless, hiding it when it matters is not.
export function selectionHasHeic(
  items: readonly Pick<AssetListItem, "id" | "filename" | "is_heic">[],
  selectedIds: Iterable<string>,
): boolean {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const id of selectedIds) {
    const item = byId.get(id);
    if (!item) return true;
    if (item.is_heic === undefined) {
      if (/\.hei[cf]$/i.test(item.filename ?? "")) return true;
    } else if (item.is_heic) {
      return true;
    }
  }
  return false;
}

// D47: at or above this estimated size the browser itself streams the zip to
// disk, so the tab never holds it in memory.
export const STREAM_TO_DISK_BYTES = 500 * 1024 * 1024;

// iPhone/iPad (any iOS browser is WebKit; iPadOS reports itself as a Mac with
// a touch screen). A Blob of a big zip can crash the tab there.
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

async function zipErrorFrom(response: Response, itemCount: number): Promise<ZipError> {
  let message = response.statusText || `Download failed (${response.status})`;
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") message = body.detail;
  } catch {
    // keep statusText
  }
  if (response.status === 422 && itemCount > MAX_ZIP_ITEMS) message = `Select at most ${MAX_ZIP_ITEMS} items`;
  if (response.status === 413) message = `Too large to download as one zip. ${message}`;
  return new ZipError(response.status, message);
}

export interface ZipTicket {
  ticket: string;
  total_bytes: number;
  expires_in: number;
  // Set for HEIC-as-JPEG zips: pass to `fetchZipReport`.
  job: string | null;
}

// Validates the selection (404/413 come back here, as JSON, before any
// navigation) and buys a one-use, 60 s ticket for a plain GET download.
export async function requestZipTicket(libraryId: number, assetIds: string[], format: "native" | "jpeg"): Promise<ZipTicket> {
  const response = await fetch(`/api/libraries/${libraryId}/zip/ticket`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset_ids: assetIds, format }),
  });
  if (!response.ok) throw await zipErrorFrom(response, assetIds.length);
  return (await response.json()) as ZipTicket;
}

// A normal browser download: the server answers with Content-Disposition:
// attachment, so the page stays put and the browser writes the stream to disk.
export function navigateToZip(libraryId: number, ticket: string) {
  const link = document.createElement("a");
  link.href = `/api/libraries/${libraryId}/zip/download?ticket=${encodeURIComponent(ticket)}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// D50: HEIC files a JPEG zip had to ship as originals.
export interface UnconvertedFile {
  id: string;
  name: string;
}

interface ZipReport {
  done: boolean;
  unconverted: UnconvertedFile[];
}

export async function fetchZipReport(libraryId: number, job: string): Promise<ZipReport> {
  const response = await fetch(`/api/libraries/${libraryId}/zip/report?job=${encodeURIComponent(job)}`, { credentials: "include" });
  if (!response.ok) throw new ZipError(response.status, "No report");
  return (await response.json()) as ZipReport;
}

// Waits for the stream to finish, then returns the files that stayed HEIC.
// Resolves to `[]` when the report is gone or unavailable: the zip itself is fine.
export async function waitForUnconverted(
  libraryId: number,
  job: string,
  options: { intervalMs?: number; maxWaitMs?: number; cancelled?: () => boolean } = {},
): Promise<UnconvertedFile[]> {
  const { intervalMs = 2000, maxWaitMs = 6 * 3600 * 1000, cancelled = () => false } = options;
  const deadline = Date.now() + maxWaitMs;
  while (!cancelled() && Date.now() < deadline) {
    try {
      const report = await fetchZipReport(libraryId, job);
      if (report.done) return report.unconverted;
    } catch {
      return [];
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return [];
}

// POSTs the selection and reads the streamed zip into a Blob, reporting
// progress. The server answers 413/404 before the first byte, so those
// surface here as a ZipError with the server's own message.
export async function fetchZip(
  libraryId: number,
  assetIds: string[],
  format: "native" | "jpeg",
  onProgress: (progress: ZipProgress) => void,
  onJob?: (job: string) => void,
): Promise<Blob> {
  const response = await fetch(`/api/libraries/${libraryId}/zip`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset_ids: assetIds, format }),
  });
  if (!response.ok) throw await zipErrorFrom(response, assetIds.length);
  const job = response.headers.get("X-Zip-Job");
  if (job) onJob?.(job);
  const header = Number(response.headers.get("X-Zip-Total-Bytes"));
  const total = Number.isFinite(header) && header > 0 ? header : null;
  // `received` counts zip bytes (headers included) while `total` sums the
  // stored file sizes, and JPEG conversion changes them again: both are
  // approximate, so the UI hides the total rather than showing an exact bar.
  const totalUnknown = format === "jpeg";
  onProgress({ received: 0, total, totalUnknown });
  if (!response.body) {
    const blob = await response.blob();
    onProgress({ received: blob.size, total, totalUnknown });
    return blob;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.length;
    onProgress({ received, total, totalUnknown });
  }
  return new Blob(parts as BlobPart[], { type: "application/zip" });
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type ZipState =
  | { phase: "idle" }
  | { phase: "downloading"; progress: ZipProgress }
  // D47: handed to the browser's own download manager.
  | { phase: "started" }
  | { phase: "error"; message: string };

export function useZipDownload(libraryId: number) {
  const [state, setState] = useState<ZipState>({ phase: "idle" });
  const [jpeg, setJpeg] = useState(false);
  // D50: HEIC files the last JPEG zip could not convert.
  const [heicFallback, setHeicFallback] = useState<UnconvertedFile[] | null>(null);
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  const watchReport = useCallback(
    (job: string) => {
      void waitForUnconverted(libraryId, job, { cancelled: () => unmounted.current }).then((files) => {
        if (files.length > 0 && !unmounted.current) setHeicFallback(files);
      });
    },
    [libraryId],
  );

  // `forceNative`: the "Download originals of these" follow-up, no conversion.
  const start = useCallback(
    async (ids: string[], options: { forceNative?: boolean } = {}) => {
      if (ids.length === 0) return;
      const format = jpeg && !options.forceNative ? "jpeg" : "native";
      setHeicFallback(null);
      setState({ phase: "downloading", progress: { received: 0, total: null } });
      try {
        // The ticket call validates the selection and reports its size, which
        // decides between the in-page progress bar and a browser download.
        const ticket = await requestZipTicket(libraryId, ids, format);
        if (isIosDevice() || ticket.total_bytes > STREAM_TO_DISK_BYTES) {
          navigateToZip(libraryId, ticket.ticket);
          setState({ phase: "started" });
          if (ticket.job) watchReport(ticket.job);
          return;
        }
        const blob = await fetchZip(
          libraryId,
          ids,
          format,
          (progress) => setState({ phase: "downloading", progress }),
          watchReport,
        );
        saveBlob(blob, "photos.zip");
        setState({ phase: "idle" });
      } catch (error) {
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : "Download failed.",
        });
      }
    },
    [libraryId, jpeg, watchReport],
  );

  const downloadOriginals = useCallback(() => {
    const ids = heicFallback?.map((file) => file.id) ?? [];
    setHeicFallback(null);
    void start(ids, { forceNative: true });
  }, [heicFallback, start]);

  return {
    state,
    start,
    jpeg,
    setJpeg,
    busy: state.phase === "downloading",
    heicFallback,
    downloadOriginals,
    dismissHeicFallback: () => setHeicFallback(null),
  };
}
