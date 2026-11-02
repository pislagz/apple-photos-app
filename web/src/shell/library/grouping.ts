import type { AssetListItem } from "../../api";

export type ViewKey = "years" | "months" | "days" | "all";

export const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "years", label: "Years" },
  { key: "months", label: "Months" },
  { key: "days", label: "Days" },
  { key: "all", label: "All Photos" },
];

export interface AssetGroup {
  key: string;
  label: string;
  items: AssetListItem[];
}

const NO_DATE_LABEL = "No Date";

function bucketKey(date: string, view: ViewKey): string {
  if (view === "years") return date.slice(0, 4);
  if (view === "months") return date.slice(0, 7);
  return date.slice(0, 10);
}

// `date` is the UTC `date_created` ISO string already bucketed by the
// server's own local-day fallback for filtering; grouping here only needs a
// stable, locale-independent prefix, not a timezone-correct calendar day.
export function formatGroupLabel(key: string, view: ViewKey): string {
  if (!key) return NO_DATE_LABEL;
  const [year, month, day] = key.split("-").map(Number);
  if (view === "years") return String(year);
  if (view === "months") {
    return new Date(Date.UTC(year, (month || 1) - 1, 1)).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1)).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Items arrive sorted descending by `date_created` (the server's own
// order), so a single contiguous pass groups them correctly without
// re-sorting -- this stays true for "all" too, where the key is a day
// bucket used only to label the pinned header, not to split the grid.
export function groupAssets(items: AssetListItem[], view: ViewKey): AssetGroup[] {
  const groups: AssetGroup[] = [];
  let current: AssetGroup | null = null;
  for (const item of items) {
    const key = item.date ? bucketKey(item.date, view) : "";
    if (!current || current.key !== key) {
      current = { key, label: formatGroupLabel(key, view), items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}
