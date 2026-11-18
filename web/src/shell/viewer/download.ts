import { getAssetDetail } from "../../api";
import { assetPageUrl, originalUrl, previewThumbUrl } from "./mediaUrls";

// A single `<a download>` click per file, so the server's audit row always
// lines up with one explicit user action.
export function triggerDownload(href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Used where the caller doesn't already have the asset's `has_edited` flag
// (the grid context menu, the export batches) -- looks it up first so
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

// Viewer ••• Download (#514): one file, original or edited, as the library shows it.
export async function downloadSingleAsset(libraryId: number, assetId: string): Promise<void> {
  const version = await resolveVersion(libraryId, assetId);
  triggerDownload(originalUrl(libraryId, assetId, version, true));
}

export async function copyAssetLink(libraryId: number, assetId: string): Promise<void> {
  await navigator.clipboard.writeText(assetPageUrl(libraryId, assetId));
}

// Copy Photo: the displayed-size JPEG as a PNG, the one image type every
// browser's clipboard accepts. The blob is a promise so Safari still counts the
// write as part of the tap.
export function canCopyImage(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext !== false &&
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

async function previewAsPng(url: string): Promise<Blob> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`copy failed: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("copy failed"))), "image/png"),
  );
}

export async function copyAssetImage(libraryId: number, assetId: string): Promise<void> {
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": previewAsPng(previewThumbUrl(libraryId, assetId)) }),
  ]);
}

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

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff",
  mov: "video/quicktime", mp4: "video/mp4", m4v: "video/x-m4v",
};

export function pickMime(type: string | null | undefined, filename: string): string {
  const clean = (type ?? "").split(";")[0].trim().toLowerCase();
  if (clean && clean !== "application/octet-stream") return clean;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? clean;
}

export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/.exec(header);
  const value = (plain?.[1] ?? plain?.[2])?.trim();
  return value || null;
}
