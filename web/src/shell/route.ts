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

// #125: the phone tab bar is Library / Albums / More / Search. Screens that
// live inside More today -- People, Places, a media type, Hidden -- get a
// route that doesn't mention "more", so moving one into Albums later (the
// issue's stated plan) only changes which list links to it, not the route
// or the screen itself.
export type MobileTab = "library" | "albums" | "more" | "search";

export type MobileRoute =
  | { tab: "library" }
  | { tab: "albums" }
  | { tab: "search" }
  | { tab: "more"; screen?: undefined }
  | { tab: "more"; screen: "people" | "places" | "hidden" }
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
      const mediaMatch = pathname.match(/^\/media\/([^/]+)\/?$/);
      if (mediaMatch) {
        return { tab: "more", screen: "media", mediaType: decodeURIComponent(mediaMatch[1]) };
      }
      return { tab: "library" };
    }
  }
}

export function mobileRoutePath(route: MobileRoute): string {
  if (route.tab === "library") return "/";
  if (route.tab !== "more") return `/${route.tab}`;
  if (!route.screen) return "/more";
  if (route.screen === "media") return `/media/${encodeURIComponent(route.mediaType)}`;
  return `/${route.screen}`;
}
