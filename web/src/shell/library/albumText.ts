import { PERSON_PREFIX, PLACE_PREFIX, SEARCH_PREFIX } from "../../api";

// #263: what an empty smart album (a media type, Favorites...) says, like Photos.
const SMART_EMPTY: Record<string, string> = {
  favorites: "No Favorites",
  "recently-added": "No Recently Added Photos",
  videos: "No Videos",
  selfies: "No Selfies",
  "live-photos": "No Live Photos",
  portrait: "No Portrait Photos",
  panoramas: "No Panoramas",
  screenshots: "No Screenshots",
  raw: "No RAW Photos",
};

// Error and empty-state copy for a grid showing `album` (an album id, or a
// `person:` / `place:` / `search:` selector); no album means the whole library.
export function albumMessages(album: string | undefined | null): { error: string; empty: string } {
  if (!album) return { error: "Couldn't load your library.", empty: "No Photos or Videos" };
  if (album.startsWith("smart:")) {
    return { error: "Couldn't load these photos.", empty: SMART_EMPTY[album.slice("smart:".length)] ?? "No Photos or Videos" };
  }
  if (album.startsWith(PERSON_PREFIX)) return { error: "Couldn't load this person's photos.", empty: "No photos of this person." };
  if (album.startsWith(PLACE_PREFIX)) return { error: "Couldn't load these photos.", empty: "No photos here." };
  if (album.startsWith(SEARCH_PREFIX)) {
    return { error: "Couldn't search.", empty: `No results for \u201c${album.slice(SEARCH_PREFIX.length)}\u201d.` };
  }
  return { error: "Couldn't load this album.", empty: "No photos in this album." };
}

// The whole-library empty state also explains itself (#263).
export const LIBRARY_EMPTY_TEXT = "Photos added to this library will appear here.";
export function isWholeLibraryEmpty(album: string | undefined | null): boolean {
  return albumMessages(album).empty === "No Photos or Videos";
}
