// URL builders for the Viewer's media -- plain strings handed to <img>/
// <video> `src`, so the browser only issues the request once something
// actually renders that element. That's what keeps "preview thumb first,
// no /original until needed" true: callers decide *when* to render the
// original/live-photo element, not whether to fetch it.
export function previewThumbUrl(libraryId: number, assetId: string): string {
  return `/api/libraries/${libraryId}/thumb/${assetId}?size=preview`;
}

export function originalUrl(libraryId: number, assetId: string): string {
  return `/api/libraries/${libraryId}/original/${assetId}`;
}

export function livePhotoVideoUrl(libraryId: number, assetId: string): string {
  return `/api/libraries/${libraryId}/livephoto/${assetId}/video`;
}
