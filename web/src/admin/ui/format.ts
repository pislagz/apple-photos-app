// Plain-English formatters for the admin panel. The server sends UTC
// timestamps, sometimes without a zone suffix; those are read as UTC.

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function toDate(value: string | number | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // "2026-11-12 10:00:00" or "2026-11-12T10:00:00" has no zone: it is UTC.
  const trimmed = value.trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const hasTime = /[T ]\d{2}:\d{2}/.test(trimmed);
  const iso = trimmed.replace(" ", "T");
  const d = new Date(hasZone || !hasTime ? (hasTime ? iso : `${iso}T00:00:00Z`) : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface FormatWhenOptions {
  now?: Date;
  /** Time zone for dates older than a week. Defaults to the browser's. */
  timeZone?: string;
}

/** "just now", "5 minutes ago", "in 2 hours", "3 days ago", then a date. */
export function formatWhen(
  value: string | number | Date | null | undefined,
  { now = new Date(), timeZone }: FormatWhenOptions = {},
): string {
  if (value === null || value === undefined || value === "") return "Never";
  const date = toDate(value);
  if (date === null) return "Unknown";
  const diff = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  const wrap = (text: string) => (diff < 0 ? `${text} ago` : `in ${text}`);
  if (abs < HOUR) return wrap(plural(Math.max(1, Math.round(abs / MINUTE)), "minute"));
  if (abs < DAY) return wrap(plural(Math.round(abs / HOUR), "hour"));
  if (abs < 7 * DAY) return wrap(plural(Math.round(abs / DAY), "day"));
  const fmt = (withYear: boolean) =>
    new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone,
    });
  const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone });
  return fmt(year.format(date) !== year.format(now)).format(date);
}

const BYTE_UNITS = ["KB", "MB", "GB", "TB", "PB", "EB"];

/** "0 bytes", "1 byte", "1.5 MB", "12 GB". Decimal units, like macOS. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  const whole = Math.floor(bytes);
  if (whole < 1000) return plural(whole, "byte");
  let value = whole;
  let unit = -1;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  let text = value < 10 ? value.toFixed(1) : String(Math.round(value));
  // 999.96 KB rounds to "1000 KB"; show 1 MB instead.
  if (Number(text) >= 1000 && unit < BYTE_UNITS.length - 1) {
    unit += 1;
    text = "1.0";
  }
  return `${text.replace(/\.0$/, "")} ${BYTE_UNITS[unit]}`;
}

/** "45 seconds", "1 minute, 30 seconds", "2 hours, 5 minutes". Two units at most. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "Unknown";
  const total = Math.floor(seconds);
  const parts: Array<[number, string]> = [
    [Math.floor(total / DAY), "day"],
    [Math.floor((total % DAY) / HOUR), "hour"],
    [Math.floor((total % HOUR) / MINUTE), "minute"],
    [total % MINUTE, "second"],
  ];
  const first = parts.findIndex(([n]) => n > 0);
  if (first === -1) return "0 seconds";
  const shown = parts.slice(first, first + 2).filter(([n]) => n > 0);
  return shown.map(([n, unit]) => plural(n, unit)).join(", ");
}
