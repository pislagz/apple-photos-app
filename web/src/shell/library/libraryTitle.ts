import type { ViewKey } from "./grouping";

// #209: one date title whose wording follows the zoom level. `date` strings are
// the naive UTC-ish ISO strings of `AssetListItem.date` (same convention as
// grouping.ts's `formatGroupLabel`), so every format reads UTC fields.
function parts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return { year, month: month || 1, day: day || 1 };
}

function utcDate(iso: string): Date {
  const { year, month, day } = parts(iso);
  return new Date(Date.UTC(year, month - 1, day));
}

// "Aug 8, 2025": one end of the desktop date range.
export function shortDate(iso: string): string {
  return utcDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// "Aug 2025": the Months level.
export function monthYear(iso: string): string {
  return utcDate(iso).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

// "8 Aug 2025": the finest iPhone level.
export function dayMonthYear(iso: string): string {
  const month = utcDate(iso).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
  const { year, day } = parts(iso);
  return `${day} ${month} ${year}`;
}

export function yearOf(iso: string): string {
  return String(parts(iso).year);
}

// Desktop title. `visibleDates` are the dates of the items on screen, newest
// first; the top row's first item decides the Years and Months wording.
export function desktopTitle(view: ViewKey, visibleDates: string[]): string {
  if (visibleDates.length === 0) return "";
  const top = visibleDates[0];
  if (view === "years") return yearOf(top);
  if (view === "months") return monthYear(top);
  const newest = shortDate(top);
  const oldest = shortDate(visibleDates[visibleDates.length - 1]);
  return newest === oldest ? newest : `${oldest} – ${newest}`;
}

// #261: the blur and tint behind the date title fade in over the first
// TITLE_SCRIM_FADE_PX of scroll instead of being there from the start.
// 0 at the top, 1 once scrolled past it; set as `--title-scrim`.
export const TITLE_SCRIM_FADE_PX = 48;

export function titleScrimProgress(scrollOffset: number): number {
  if (!(scrollOffset > 0)) return 0;
  return Math.round(Math.min(1, scrollOffset / TITLE_SCRIM_FADE_PX) * 100) / 100;
}

// iPhone All Photos has pinch columns 2..7. Up to PHONE_DAY_COLUMNS the
// subtitle names the day; one step coarser it names the month; the coarsest
// level swaps the large title for a year pill.
export const PHONE_DAY_COLUMNS = 5;
export const PHONE_PILL_COLUMNS = 7;

export interface PhoneTitle {
  subtitle: string;
  pill: string;
}

export function phoneTitle(columns: number, topDate: string | undefined): PhoneTitle {
  if (!topDate) return { subtitle: "", pill: "" };
  if (columns >= PHONE_PILL_COLUMNS) return { subtitle: "", pill: yearOf(topDate) };
  if (columns > PHONE_DAY_COLUMNS) return { subtitle: monthYear(topDate), pill: "" };
  return { subtitle: dayMonthYear(topDate), pill: "" };
}
