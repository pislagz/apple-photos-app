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
