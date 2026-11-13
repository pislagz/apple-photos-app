import type { AssetListItem } from "../../api";

// The iPhone select bar's middle label, worded like Photos: "1 Photo
// Selected", "3 Videos Selected", "5 Items Selected" for a mix (#259).
export function selectionCountLabel(items: AssetListItem[], selectedIds: ReadonlySet<string>): string {
  if (selectedIds.size === 0) return "Select Items";
  let videos = 0;
  let photos = 0;
  for (const item of items) {
    if (!selectedIds.has(item.id)) continue;
    if (item.is_video) videos += 1;
    else photos += 1;
  }
  const count = selectedIds.size;
  // An id not in `items` (not loaded) has an unknown kind: call it an item.
  const noun = videos === count ? "Video" : photos === count ? "Photo" : "Item";
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"} Selected`;
}
