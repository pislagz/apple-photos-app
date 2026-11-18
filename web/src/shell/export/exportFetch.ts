import { filenameFromDisposition, pickMime, resolveVersion, shareFileName } from "../viewer/download";
import { livePhotoVideoUrl, originalJpegFallbackUrl, originalUrl } from "../viewer/mediaUrls";
import type { ExportFormat, ExportItem } from "./exportModel";

export class ExportAbort extends Error {}
export class ExportTooLarge extends Error {}
export class ExportHttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`request failed: ${status}`);
    this.status = status;
  }
}

export interface PlannedFile {
  item: ExportItem;
  kind: "still" | "live";
}

// One file per item, plus the paired video of a Live Photo when exporting
// originals "as stored". The Compatible JPEG choice is the still only.
export function planFiles(items: ExportItem[], format: ExportFormat): PlannedFile[] {
  const planned: PlannedFile[] = [];
  for (const item of items) {
    planned.push({ item, kind: "still" });
    if (format === "original" && item.is_live_photo && !item.is_video) planned.push({ item, kind: "live" });
  }
  return planned;
}

export interface OpenedFile {
  response: Response;
  name: string;
  type: string;
}

// Opens the response (headers only). The body is read by `readToFile` or
// streamed to disk by the caller. A JPEG already stored as JPEG (is_heic is
// false) is sent untouched rather than re-encoded.
export async function plannedUrl(libraryId: number, planned: PlannedFile, format: ExportFormat, version?: "original" | "edited"): Promise<string> {
  const { item } = planned;
  if (planned.kind === "live") return livePhotoVideoUrl(libraryId, item.id);
  const resolved = version ?? (await resolveVersion(libraryId, item.id));
  const convert = format === "jpeg" && !item.is_video && item.is_heic !== false;
  return convert ? originalJpegFallbackUrl(libraryId, item.id, resolved, true) : originalUrl(libraryId, item.id, resolved, true);
}

export async function openPlanned(libraryId: number, planned: PlannedFile, format: ExportFormat, signal: AbortSignal): Promise<OpenedFile> {
  const { item } = planned;
  const url = await plannedUrl(libraryId, planned, format);
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", signal });
  } catch (error) {
    if (signal.aborted) throw new ExportAbort();
    throw error;
  }
  if (!response.ok) throw new ExportHttpError(response.status);
  const headerType = response.headers.get("content-type");
  const fallbackName = shareFileName(item, headerType?.split(";")[0] ?? "");
  const name = filenameFromDisposition(response.headers.get("content-disposition")) ?? fallbackName;
  return { response, name, type: pickMime(headerType, name) };
}

// Reads a body chunk by chunk, so progress is real and an abort or the size
// cap stops the transfer. `onChunk` may throw to stop.
export async function pump(response: Response, signal: AbortSignal, onChunk: (chunk: Uint8Array) => void | Promise<void>): Promise<void> {
  if (!response.body) {
    onChunk(new Uint8Array(await response.arrayBuffer()));
    return;
  }
  const reader = response.body.getReader();
  try {
    for (;;) {
      if (signal.aborted) throw new ExportAbort();
      const { done, value } = await reader.read();
      if (done) return;
      await onChunk(value);
    }
  } catch (error) {
    if (signal.aborted) throw new ExportAbort();
    throw error;
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export async function readToFile(opened: OpenedFile, name: string, signal: AbortSignal, onBytes: (n: number) => void): Promise<File> {
  const parts: Uint8Array[] = [];
  await pump(opened.response, signal, (chunk) => {
    parts.push(chunk);
    onBytes(chunk.length);
  });
  return new File(parts as BlobPart[], name, { type: opened.type });
}

// Words for the failure screen; never the raw exception.
export function describeExportError(error: unknown): string {
  if (error instanceof ExportHttpError) {
    if (error.status === 404) return "A file could not be found. It may have been moved out of the library.";
    if (error.status === 401 || error.status === 403) return "You were signed out. Sign in again and retry.";
    return `The server could not send a file (${error.status}). Try again.`;
  }
  if (error instanceof TypeError) return "The connection dropped. Check your network and try again.";
  if (error instanceof DOMException && error.name === "QuotaExceededError") return "There is not enough free space for these files.";
  return error instanceof Error && error.message ? error.message : "The export failed. Try again.";
}
