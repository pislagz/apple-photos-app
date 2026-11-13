// Two-line viewer title (#211): line 1 is the relative day, line 2 is
// "time · place". Pure so it can be tested with a fixed `now`.

export interface ViewerTitle {
  primary: string;
  secondary: string;
}

// `date_created` is naive "YYYY-MM-DDTHH:MM:SS" (see viewerInfo.formatDateLine):
// the stored wall-clock is shown as is, so compare it with the wall-clock
// calendar day of `now` in the browser's own zone.
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;
const DAY_MS = 86_400_000;

export function formatRelativeDay(iso: string | null, now: Date = new Date()): string {
  const match = iso ? NAIVE.exec(iso) : null;
  if (!match) return "";
  const [, year, month, day] = match;
  const taken = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today - taken) / DAY_MS);
  const when = new Date(taken);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  // The past week by name; anything older (or in the future) by date.
  if (days >= 2 && days <= 6) return when.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" });
  return when.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function formatClock(iso: string | null): string {
  const match = iso ? NAIVE.exec(iso) : null;
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  return date.toLocaleTimeString(undefined, { timeStyle: "short", timeZone: "UTC" });
}

export function formatViewerTitle(iso: string | null, place: string, now: Date = new Date()): ViewerTitle {
  const day = formatRelativeDay(iso, now);
  const secondary = [formatClock(iso), place].filter(Boolean).join(" · ");
  // No date at all: the place is the only thing worth a title line.
  if (!day) return { primary: place, secondary: "" };
  return { primary: day, secondary };
}

// #302 desktop bar: "14 June 2026 at 21:08:35 · 70 864 of 71 246". The stored
// wall-clock is shown as is (see NAIVE above); counts use the locale grouping.
export function formatViewerDateTime(iso: string | null): string {
  const match = iso ? NAIVE.exec(iso) : null;
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  const second = /^.{16}:(\d{2})/.exec(iso ?? "")?.[1] ?? "00";
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  return date.toLocaleString(undefined, { dateStyle: "long", timeStyle: "medium", timeZone: "UTC" });
}

export function formatPosition(index: number, total: number): string {
  return `${(index + 1).toLocaleString()} of ${total.toLocaleString()}`;
}

export function formatDesktopTitle(opts: {
  place: string;
  filename: string;
  dateCreated: string | null;
  index: number;
  total: number;
}): ViewerTitle {
  const secondary = [formatViewerDateTime(opts.dateCreated), formatPosition(opts.index, opts.total)].filter(Boolean).join(" · ");
  return { primary: opts.place || opts.filename, secondary };
}
