import { useEffect, useRef } from "react";
import type { AssetListItem } from "../../api";
import { previewThumbUrl } from "./mediaUrls";

// #286: warm the browser cache with the previews of the photos on either side,
// so a swipe slides in a decoded photo rather than an empty page. Skipped
// while the filmstrip is being scrubbed (each step would start a fetch).
export function usePreloadNeighbours(libraryId: number, items: AssetListItem[], index: number, paused = false) {
  // Held so the requests are not garbage-collected before they finish.
  const held = useRef<HTMLImageElement[]>([]);
  useEffect(() => {
    if (paused || typeof Image === "undefined") return;
    const images: HTMLImageElement[] = [];
    for (const offset of [1, -1, 2, -2]) {
      const neighbour = items[index + offset];
      if (!neighbour || neighbour.is_video) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = previewThumbUrl(libraryId, neighbour.id);
      images.push(img);
    }
    held.current = images;
  }, [libraryId, items, index, paused]);
}
