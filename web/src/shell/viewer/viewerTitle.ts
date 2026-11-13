// Viewer titles that read like Apple Photos (#302). Pure so they can be tested
// with a fixed `now`. Never a file name.
//
// iOS (formatViewerTitle): no place -> line 1 date (Today / Yesterday /
// weekday for the past week, "28 October" this year, "19 May 2025" before),
// line 2 the time. With a place -> line 1 the place, line 2 "date  time"
// (two spaces). No "N of M".
// Mac (formatDesktopTitle): no place -> "1 June 2026 at 15:28:39" over
// "N of M"; with a place -> the place over "date at time · N of M". The Mac
// date is always the full date, never Today/Yesterday.

export interface ViewerTitle {
  primary: string;
  secondary: string;
}

// `date_created` is naive "YYYY-MM-DDTHH:MM:SS" (see viewerInfo.formatDateLine):
// the stored wall-clock is shown as is, so compare it with the wall-clock
// calendar day of `now` in the browser's own zone.
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
const DAY_MS = 86_400_000;

function parse(iso: string | null) {
  const match = iso ? NAIVE.exec(iso) : null;
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? 0)));
}

// iOS date part: relative for the past week, then day + month, then with year.
export function formatRelativeDay(iso: string | null, now: Date = new Date()): string {
  const when = parse(iso);
  if (!when) return "";
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const taken = Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate());
  const days = Math.round((today - taken) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days >= 2 && days <= 6) return when.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" });
  if (when.getUTCFullYear() === now.getFullYear()) {
    return when.toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: "UTC" });
  }
  return formatFullDate(iso);
}

export function formatFullDate(iso: string | null): string {
  const when = parse(iso);
  return when ? when.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
}

// 24 hour clock, as Apple Photos shows it in the reference screenshots.
export function formatClock(iso: string | null, withSeconds = false): string {
  const when = parse(iso);
  if (!when) return "";
  return when.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hourCycle: "h23",
    timeZone: "UTC",
  });
}

export function formatViewerTitle(iso: string | null, place: string, now: Date = new Date()): ViewerTitle {
  const day = formatRelativeDay(iso, now);
  const time = formatClock(iso);
  if (!day) return { primary: place, secondary: "" };
  if (!place) return { primary: day, secondary: time };
  return { primary: place, secondary: `${day}  ${time}` };
}

export function formatPosition(index: number, total: number): string {
  return `${(index + 1).toLocaleString()} of ${total.toLocaleString()}`;
}

export function formatDesktopTitle(opts: {
  place: string;
  dateCreated: string | null;
  index: number;
  total: number;
  now?: Date;
}): ViewerTitle {
  const position = formatPosition(opts.index, opts.total);
  const date = formatFullDate(opts.dateCreated);
  if (!date) return { primary: opts.place, secondary: position };
  const when = `${date} at ${formatClock(opts.dateCreated, true)}`;
  if (!opts.place) return { primary: when, secondary: position };
  return { primary: opts.place, secondary: `${when} · ${position}` };
}
