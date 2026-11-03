// URL builders for the Viewer's media -- plain strings handed to <img>/
// <video> `src`, so the browser only issues the request once something
// actually renders that element. That's what keeps "preview thumb first,
// no /original until needed" true: callers decide *when* to render the
// original/live-photo element, not whether to fetch it.
export function previewThumbUrl(libraryId: number, assetId: string): string {
  return `/api/libraries/${libraryId}/thumb/${assetId}?size=preview`;
}

// `download` must stay `false` for viewer zoom, the HEIC->JPEG fallback, and
// video play -- the server only writes an audit row when it's `true`, which
// callers set for an explicit Download/share action.
export function originalUrl(
  libraryId: number,
  assetId: string,
  version: "original" | "edited" = "original",
  download = false,
): string {
  const params = [];
  if (version === "edited") params.push("version=edited");
  if (download) params.push("download=1");
  return `/api/libraries/${libraryId}/original/${assetId}${params.length ? `?${params.join("&")}` : ""}`;
}

// P1.17: a browser that can't decode HEIC fires `onError` on the <img>
// showing `originalUrl` -- this asks the server to transcode the same file
// to JPEG instead, so the full-resolution view still renders.
export function originalJpegFallbackUrl(
  libraryId: number,
  assetId: string,
  version: "original" | "edited" = "original",
  download = false,
): string {
  const params = ["format=jpeg"];
  if (version === "edited") params.push("version=edited");
  if (download) params.push("download=1");
  return `/api/libraries/${libraryId}/original/${assetId}?${params.join("&")}`;
}

export function livePhotoVideoUrl(libraryId: number, assetId: string): string {
  return `/api/libraries/${libraryId}/livephoto/${assetId}/video`;
}

// P1.17 "Copy link": a same-origin, in-app URL (never the raw `/original`
// file URL) that identifies a photo within this app. `route.ts` parses this
// same shape back so a pasted link reopens the photo in the viewer.
export function assetPageUrl(libraryId: number, assetId: string): string {
  return `${window.location.origin}/library/${libraryId}/photo/${assetId}`;
}
