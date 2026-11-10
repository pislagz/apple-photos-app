import { useCallback, useState } from "react";

export interface ZipProgress {
  received: number;
  // From X-Zip-Total-Bytes (sum of the stored file sizes); null if absent.
  total: number | null;
  // HEIC->JPEG conversion changes the sizes, so the total is only a guess.
  approximate?: boolean;
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

// POSTs the selection and reads the streamed zip into a Blob, reporting
// progress. The server answers 413/404 before the first byte, so those
// surface here as a ZipError with the server's own message.
export async function fetchZip(
  libraryId: number,
  assetIds: string[],
  format: "native" | "jpeg",
  onProgress: (progress: ZipProgress) => void,
): Promise<Blob> {
  const response = await fetch(`/api/libraries/${libraryId}/zip`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset_ids: assetIds, format }),
  });
  if (!response.ok) {
    let message = response.statusText || `Download failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") message = body.detail;
    } catch {
      // keep statusText
    }
    if (response.status === 422 && assetIds.length > MAX_ZIP_ITEMS) message = `Select at most ${MAX_ZIP_ITEMS} items`;
    if (response.status === 413) message = `Too large to download as one zip. ${message}`;
    throw new ZipError(response.status, message);
  }
  const header = Number(response.headers.get("X-Zip-Total-Bytes"));
  const total = Number.isFinite(header) && header > 0 ? header : null;
  // `received` counts zip bytes (headers included) while `total` sums the
  // stored file sizes, and JPEG conversion changes them again: both are
  // approximate, so the UI says so rather than showing an exact bar.
  const approximate = format === "jpeg";
  onProgress({ received: 0, total, approximate });
  if (!response.body) {
    const blob = await response.blob();
    onProgress({ received: blob.size, total, approximate });
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
    onProgress({ received, total, approximate });
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
  | { phase: "error"; message: string };

export function useZipDownload(libraryId: number) {
  const [state, setState] = useState<ZipState>({ phase: "idle" });
  const [jpeg, setJpeg] = useState(false);

  const start = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setState({ phase: "downloading", progress: { received: 0, total: null } });
      try {
        const blob = await fetchZip(libraryId, ids, jpeg ? "jpeg" : "native", (progress) =>
          setState({ phase: "downloading", progress }),
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
    [libraryId, jpeg],
  );

  return { state, start, jpeg, setJpeg, busy: state.phase === "downloading" };
}
