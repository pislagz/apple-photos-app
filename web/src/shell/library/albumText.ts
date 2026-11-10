import { PERSON_PREFIX, PLACE_PREFIX, SEARCH_PREFIX } from "../../api";

// Error and empty-state copy for a grid showing `album` (an album id, or a
// `person:` / `place:` / `search:` selector); no album means the whole library.
export function albumMessages(album: string | undefined | null): { error: string; empty: string } {
  if (!album) return { error: "Couldn't load your library.", empty: "No photos yet." };
  if (album.startsWith(PERSON_PREFIX)) return { error: "Couldn't load this person's photos.", empty: "No photos of this person." };
  if (album.startsWith(PLACE_PREFIX)) return { error: "Couldn't load these photos.", empty: "No photos here." };
  if (album.startsWith(SEARCH_PREFIX)) {
    return { error: "Couldn't search.", empty: `No results for \u201c${album.slice(SEARCH_PREFIX.length)}\u201d.` };
  }
  return { error: "Couldn't load this album.", empty: "No photos in this album." };
}
