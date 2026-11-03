// P1.17 "Copy Link" writes `assetPageUrl()` (mediaUrls.ts) -- this parses
// that same shape back, so a pasted link opens the photo instead of landing
// on a route the app doesn't know. Never resolves straight to an API call:
// the caller still has to find the asset in a library the signed-in user is
// actually assigned, so a foreign/hidden id 404s the normal way instead of
// leaking existence here.
export interface PhotoPath {
  libraryId: number;
  assetId: string;
}

export function parsePhotoPath(pathname: string): PhotoPath | null {
  const match = pathname.match(/^\/library\/(\d+)\/photo\/([^/]+)\/?$/);
  if (!match) return null;
  return { libraryId: Number(match[1]), assetId: decodeURIComponent(match[2]) };
}
