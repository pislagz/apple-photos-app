// URL builders for the Viewer's media -- plain strings handed to <img>/
// <video> `src`, so the browser only issues the request once something
// actually renders that element. That's what keeps "preview thumb first,
// no /original until needed" true: callers decide *when* to render the
// original/live-photo element, not whether to fetch it.
export function previewThumbUrl(libraryId: number, assetId: string): string {
  return `/api/libraries/${libraryId}/thumb/${assetId}?size=preview`;
}

export function originalUrl(libraryId: number, assetId: string, version: "original" | "edited" = "original"): string {
  const params = version === "edited" ? "?version=edited" : "";
  return `/api/libraries/${libraryId}/original/${assetId}${params}`;
}

// P1.17: a browser that can't decode HEIC fires `onError` on the <img>
// showing `originalUrl` -- this asks the server to transcode the same file
// to JPEG instead, so the full-resolution view still renders.
export function originalJpegFallbackUrl(
  libraryId: number,
  assetId: string,
  version: "original" | "edited" = "original",
): string {
  const params = version === "edited" ? "&version=edited" : "";
  return `/api/libraries/${libraryId}/original/${assetId}?format=jpeg${params}`;
}

export function livePhotoVideoUrl(libraryId: number, assetId: string): string {
  return `/api/libraries/${libraryId}/livephoto/${assetId}/video`;
}

// P1.17 "Copy link": a same-origin, in-app URL (never the raw `/original`
// file URL) that identifies a photo within this app. There is no
// client-side router yet to resolve it back to an open viewer -- it's a
// stable, shareable identifier a later phase can wire up to actually
// navigate.
export function assetPageUrl(libraryId: number, assetId: string): string {
  return `${window.location.origin}/library/${libraryId}/photo/${assetId}`;
}
