import { getAssetDetail } from "../../api";
import { assetPageUrl, originalUrl } from "./mediaUrls";

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

export async function copyAssetLink(libraryId: number, assetId: string): Promise<void> {
  await navigator.clipboard.writeText(assetPageUrl(libraryId, assetId));
}

// iOS Safari's Web Share API caps how many files one `share()` call can
// carry; this is a conservative batch size, not a number from a spec.
const SHARE_BATCH_SIZE = 5;

type ShareItem = { id: string; filename: string | null; original_filename?: string | null };

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/gif": ".gif",
  "image/tiff": ".tiff",
  "video/quicktime": ".mov",
  "video/mp4": ".mp4",
};

// The name the user knows (IMG_1234.HEIC), not Photos' internal UUID name,
// with the extension matched to the blob actually sent (an edited JPEG or a
// HEIC converted to JPEG must not keep ".HEIC").
export function shareFileName(item: ShareItem, blobType: string): string {
  const raw = (item.original_filename || item.filename || item.id).replace(/[\u0000-\u001f\u007f/\\]/g, "_");
  const match = /\.[A-Za-z0-9]{1,5}$/.exec(raw);
  const stem = match ? raw.slice(0, match.index) : raw;
  const typeExt = EXTENSION_BY_TYPE[blobType.toLowerCase()];
  const sameKind = (a: string, b: string) => a.toLowerCase().replace(".jpeg", ".jpg") === b;
  // Keep the original's own spelling (.HEIC, .jpeg) when it already matches the blob.
  const ext = match && (!typeExt || sameKind(match[0], typeExt)) ? match[0] : (typeExt ?? "");
  return `${stem || item.id}${ext}`;
}

// A share fetch is audited as a download even if the share sheet is cancelled; accepted (admin-only log)
async function fetchAsFile(
  libraryId: number,
  item: ShareItem,
  version: "original" | "edited",
): Promise<File> {
  const response = await fetch(originalUrl(libraryId, item.id, version, true), { credentials: "same-origin" });
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  const blob = await response.blob();
  return new File([blob], shareFileName(item, blob.type), { type: blob.type });
}

// iPhone multi-select share (P1.17): one `navigator.share({ files })` call
// per batch, so the native share sheet (or "Save to Photos" via it) sees a
// manageable number of files at a time. Falls back to plain download links,
// per item, when the Web Share API or file sharing isn't available --
// never when the user simply dismisses the share sheet (`AbortError`).
export async function shareOrDownloadAssets(
  libraryId: number,
  items: ShareItem[],
): Promise<void> {
  const canShareFiles = typeof navigator.canShare === "function" && typeof navigator.share === "function";
  for (let start = 0; start < items.length; start += SHARE_BATCH_SIZE) {
    const batch = items.slice(start, start + SHARE_BATCH_SIZE);
    const versions = await Promise.all(batch.map((item) => resolveVersion(libraryId, item.id)));
    if (!canShareFiles) {
      batch.forEach((item, i) => downloadVersion(libraryId, item.id, versions[i]));
      continue;
    }
    try {
      const files = await Promise.all(batch.map((item, i) => fetchAsFile(libraryId, item, versions[i])));
      if (!navigator.canShare({ files })) throw new Error("cannot share these files");
      await navigator.share({ files });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") continue;
      batch.forEach((item, i) => downloadVersion(libraryId, item.id, versions[i]));
    }
  }
}

// Desktop toolbar Share (#274): only where the browser can share files (Safari
// on Mac -> system share sheet with AirDrop). Files keep their original
// filenames; no download fallback, the caller disables the button instead.
export function canShareFiles(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.canShare === "function" && typeof navigator.share === "function";
}

export async function shareAssets(
  libraryId: number,
  items: { id: string; filename: string | null }[],
): Promise<void> {
  if (!canShareFiles() || items.length === 0) return;
  const versions = await Promise.all(items.map((item) => resolveVersion(libraryId, item.id)));
  const files = await Promise.all(items.map((item, i) => fetchAsFile(libraryId, item, versions[i])));
  if (!navigator.canShare({ files })) throw new Error("cannot share these files");
  try {
    await navigator.share({ files });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    throw error;
  }
}
