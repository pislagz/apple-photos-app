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
// (the grid context menu) -- looks it up first so a right-click download
// picks the same version the viewer would.
export async function downloadAsset(libraryId: number, assetId: string): Promise<void> {
  let version: "original" | "edited" = "original";
  try {
    const detail = await getAssetDetail(libraryId, assetId);
    if (detail.has_edited) version = "edited";
  } catch {
    // Foreign/missing asset: fall back to "original" and let the server's
    // own 404 on the download request be the source of truth.
  }
  downloadVersion(libraryId, assetId, version);
}

export async function copyAssetLink(libraryId: number, assetId: string): Promise<void> {
  await navigator.clipboard.writeText(assetPageUrl(libraryId, assetId));
}

// iOS Safari's Web Share API caps how many files one `share()` call can
// carry; this is a conservative batch size, not a number from a spec.
const SHARE_BATCH_SIZE = 5;

// A share fetch is audited as a download even if the share sheet is cancelled; accepted (admin-only log)
async function fetchAsFile(libraryId: number, item: { id: string; filename: string | null }): Promise<File> {
  const response = await fetch(originalUrl(libraryId, item.id, "original", true), { credentials: "same-origin" });
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  const blob = await response.blob();
  return new File([blob], item.filename ?? item.id, { type: blob.type });
}

// iPhone multi-select share (P1.17): one `navigator.share({ files })` call
// per batch, so the native share sheet (or "Save to Photos" via it) sees a
// manageable number of files at a time. Falls back to plain download links,
// per item, when the Web Share API or file sharing isn't available --
// never when the user simply dismisses the share sheet (`AbortError`).
export async function shareOrDownloadAssets(
  libraryId: number,
  items: { id: string; filename: string | null }[],
): Promise<void> {
  const canShareFiles = typeof navigator.canShare === "function" && typeof navigator.share === "function";
  for (let start = 0; start < items.length; start += SHARE_BATCH_SIZE) {
    const batch = items.slice(start, start + SHARE_BATCH_SIZE);
    if (!canShareFiles) {
      for (const item of batch) downloadVersion(libraryId, item.id, "original");
      continue;
    }
    try {
      const files = await Promise.all(batch.map((item) => fetchAsFile(libraryId, item)));
      if (!navigator.canShare({ files })) throw new Error("cannot share these files");
      await navigator.share({ files });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") continue;
      for (const item of batch) downloadVersion(libraryId, item.id, "original");
    }
  }
}
