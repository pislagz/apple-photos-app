import type { LibraryRow } from "./rows";
import type { ViewKey } from "./grouping";

// #212: iOS Photos shows a smaller date line under "Library". At 3 columns or
// fewer it is "May 2024"; with more columns (and in Days) it is "10 May 2024".
const MONTH_YEAR_MAX_COLUMNS = 3;

export function formatSubtitleDate(date: string | null | undefined, columns: number, view: ViewKey): string {
  if (!date) return "";
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  if (!year || !month) return "";
  const monthYear = view === "all" && columns <= MONTH_YEAR_MAX_COLUMNS;
  return new Date(Date.UTC(year, month - 1, day || 1)).toLocaleDateString("en-GB", {
    ...(monthYear ? {} : { day: "numeric" }),
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// The date of the topmost visible row. Years and Months show no subtitle
// (their tiles carry the period). TODO(#307, #301): the period-card PRs give
// those levels a pill label; wire it in here when they land.
export function subtitleForRow(row: LibraryRow | undefined, columns: number, view: ViewKey): string {
  if (!row || (row.type !== "grid" && row.type !== "feature")) return "";
  return formatSubtitleDate(row.items[0]?.date, columns, view);
}
