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

// A malformed percent escape (`/places/%E0`) must not crash the shell: it is
// just a path that matches nothing.
function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parsePhotoPath(pathname: string): PhotoPath | null {
  const match = pathname.match(/^\/library\/(\d+)\/photo\/([^/]+)\/?$/);
  if (!match) return null;
  const assetId = decode(match[2]);
  if (assetId === null) return null;
  return { libraryId: Number(match[1]), assetId };
}

// #125: the phone tab bar is Library / Albums / More / Search. Screens that
// live inside More today -- People, Places, a media type, Hidden -- get a
// route that doesn't mention "more", so moving one into Albums later (the
// issue's stated plan) only changes which list links to it, not the route
// or the screen itself.
export type MobileTab = "library" | "albums" | "more" | "search";

export type MobileRoute =
  | { tab: "library" }
  | { tab: "albums"; folderId?: string; albumId?: string }
  | { tab: "search"; query?: string }
  | { tab: "more"; screen?: undefined }
  | { tab: "more"; screen: "people"; personId?: string }
  | { tab: "more"; screen: "places"; bbox?: string }
  | { tab: "more"; screen: "hidden" }
  | { tab: "more"; screen: "media"; mediaType: string };

export function parseMobileRoute(pathname: string): MobileRoute {
  switch (pathname) {
    case "/albums":
      return { tab: "albums" };
    case "/search":
      return { tab: "search" };
    case "/more":
      return { tab: "more" };
    case "/people":
      return { tab: "more", screen: "people" };
    case "/places":
      return { tab: "more", screen: "places" };
    case "/hidden":
      return { tab: "more", screen: "hidden" };
    default: {
      // P2.1: /albums/folder/<uuid> and /albums/<uuid> (or smart:<slug>).
      const folderMatch = pathname.match(/^\/albums\/folder\/([^/]+)\/?$/);
      const folderMatchValue = folderMatch ? decode(folderMatch[1]) : null;
      if (folderMatchValue !== null) return { tab: "albums", folderId: folderMatchValue };
      const albumMatch = pathname.match(/^\/albums\/([^/]+)\/?$/);
      const albumMatchValue = albumMatch ? decode(albumMatch[1]) : null;
      if (albumMatchValue !== null) return { tab: "albums", albumId: albumMatchValue };
      // P2.2: /people/<uuid>.
      const personMatch = pathname.match(/^\/people\/([^/]+)\/?$/);
      const personMatchValue = personMatch ? decode(personMatch[1]) : null;
      if (personMatchValue !== null) return { tab: "more", screen: "people", personId: personMatchValue };
      // P2.3: /places is the map; /places/<w,s,e,n> is the photos under a pin.
      const placeMatch = pathname.match(/^\/places\/([^/]+)\/?$/);
      const placeMatchValue = placeMatch ? decode(placeMatch[1]) : null;
      if (placeMatchValue !== null) return { tab: "more", screen: "places", bbox: placeMatchValue };
      // P2.4: /search/<query> is a results page.
      const searchMatch = pathname.match(/^\/search\/([^/]+)\/?$/);
      const searchMatchValue = searchMatch ? decode(searchMatch[1]) : null;
      if (searchMatchValue !== null) return { tab: "search", query: searchMatchValue };
      const mediaMatch = pathname.match(/^\/media\/([^/]+)\/?$/);
      const mediaMatchValue = mediaMatch ? decode(mediaMatch[1]) : null;
      if (mediaMatchValue !== null) return { tab: "more", screen: "media", mediaType: mediaMatchValue };
      return { tab: "library" };
    }
  }
}

export function mobileRoutePath(route: MobileRoute): string {
  if (route.tab === "library") return "/";
  if (route.tab === "albums") {
    if (route.folderId) return `/albums/folder/${encodeURIComponent(route.folderId)}`;
    if (route.albumId) return `/albums/${encodeURIComponent(route.albumId)}`;
  }
  if (route.tab === "search" && route.query) return `/search/${encodeURIComponent(route.query)}`;
  if (route.tab !== "more") return `/${route.tab}`;
  if (!route.screen) return "/more";
  if (route.screen === "media") return `/media/${encodeURIComponent(route.mediaType)}`;
  if (route.screen === "people" && route.personId) return `/people/${encodeURIComponent(route.personId)}`;
  if (route.screen === "places" && route.bbox) return `/places/${encodeURIComponent(route.bbox)}`;
  return `/${route.screen}`;
}
