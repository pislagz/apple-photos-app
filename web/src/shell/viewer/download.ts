import { getAssetDetail } from "../../api";
import { assetPageUrl, originalJpegFallbackUrl, originalUrl } from "./mediaUrls";

// Phase 1 download is one file at a time (CLAUDE.md), original or edited
// (P1.17) -- whichever is "the" photo as the library shows it. A single
// `<a download>` click, not a dropdown, so the server's audit row always
// lines up with one explicit user action.
function triggerDownload(href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function downloadVersion(libraryId: number, assetId: string, version: "original" | "edited") {
  triggerDownload(originalUrl(libraryId, assetId, version, true));
}

// Used where the caller doesn't already have the asset's `has_edited` flag
// (the grid context menu, the share batches below) -- looks it up first so
// a right-click download or share picks the same version the viewer would.
export async function resolveVersion(libraryId: number, assetId: string): Promise<"original" | "edited"> {
  try {
    const detail = await getAssetDetail(libraryId, assetId);
    return detail.has_edited ? "edited" : "original";
  } catch {
    // Foreign/missing asset: fall back to "original" and let the server's
    // own 404 on the download request be the source of truth.
    return "original";
  }
}

export async function downloadAsset(libraryId: number, assetId: string): Promise<void> {
  const version = await resolveVersion(libraryId, assetId);
  downloadVersion(libraryId, assetId, version);
}

// Select-bar Download with exactly one item: the plain file under its own
// name, or its JPEG rendition when "HEIC as JPEG" is on.
export async function downloadSingleAsset(
  libraryId: number,
  assetId: string,
  options: { asJpeg?: boolean } = {},
): Promise<void> {
  const version = await resolveVersion(libraryId, assetId);
  triggerDownload(
    options.asJpeg
      ? originalJpegFallbackUrl(libraryId, assetId, version, true)
      : originalUrl(libraryId, assetId, version, true),
  );
}

export async function copyAssetLink(libraryId: number, assetId: string): Promise<void> {
  await navigator.clipboard.writeText(assetPageUrl(libraryId, assetId));
}

// A share fetch is audited as a download even if the share sheet is cancelled; accepted (admin-only log)
async function fetchAsFile(
  libraryId: number,
  item: { id: string; filename: string | null },
): Promise<File> {
  const version = await resolveVersion(libraryId, item.id);
  const response = await fetch(originalUrl(libraryId, item.id, version, true), { credentials: "same-origin" });
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  const blob = await response.blob();
  return new File([blob], item.filename ?? item.id, { type: blob.type });
}

export type ShareOutcome =
  | { status: "shared" | "cancelled" | "downloaded" }
  // The files are fetched but the browser refused `share()` because the tap's
  // user activation had expired while they downloaded. Share them from the
  // next tap with `shareReadyFiles`, which calls `share()` synchronously.
  | { status: "ready"; files: File[] };

// Calls `navigator.share` with no await before it, so it is safe to run
// straight from a click handler.
export async function shareReadyFiles(files: File[]): Promise<ShareOutcome> {
  try {
    await navigator.share({ files });
    return { status: "shared" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { status: "cancelled" };
    if (error instanceof DOMException && error.name === "NotAllowedError") return { status: "ready", files };
    throw error;
  }
}

// iPhone multi-select share (P1.17): ONE `navigator.share({ files })` call
// with every selected file, so the share sheet shows them all. (It used to
// batch by 5 and fall back to one download link per item on any error; iOS
// Safari lets only the first programmatic download through, so a share that
// lost its user activation while the files fetched looked like "only 1
// photo shared".) Plain download links remain only for browsers with no
// file-sharing support. Never fall back when the user dismisses the sheet.
export async function shareOrDownloadAssets(
  libraryId: number,
  items: { id: string; filename: string | null }[],
): Promise<ShareOutcome> {
  const canShareFiles = typeof navigator.canShare === "function" && typeof navigator.share === "function";
  const downloadAll = async (): Promise<ShareOutcome> => {
    for (const item of items) await downloadAsset(libraryId, item.id);
    return { status: "downloaded" };
  };
  if (!canShareFiles) return downloadAll();
  let files: File[];
  try {
    // All files in parallel: the shortest possible gap before `share()`.
    files = await Promise.all(items.map((item) => fetchAsFile(libraryId, item)));
  } catch {
    return downloadAll();
  }
  if (!navigator.canShare({ files })) return downloadAll();
  try {
    return await shareReadyFiles(files);
  } catch {
    return downloadAll();
  }
}
