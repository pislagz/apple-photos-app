// The ready choices offered on the Settings screen. Values are what the server
// stores (seconds, bytes, minutes); labels are what people read. No free value.
import { formatDuration } from "../ui/format";

export interface Choice {
  value: number;
  label: string;
}

const HOUR = 3600;
const DAY = 86400;
const MB = 1024 ** 2;
const GB = 1024 ** 3;

export const DESKTOP_SESSION: Choice[] = [
  { value: HOUR, label: "1 hour" },
  { value: 4 * HOUR, label: "4 hours" },
  { value: 12 * HOUR, label: "12 hours" },
  { value: DAY, label: "1 day" },
  { value: 7 * DAY, label: "7 days" },
];

export const PWA_SESSION: Choice[] = [
  { value: DAY, label: "1 day" },
  { value: 7 * DAY, label: "7 days" },
  { value: 30 * DAY, label: "30 days" },
  { value: 90 * DAY, label: "90 days" },
];

export const REMEMBER_SESSION: Choice[] = [
  { value: 30 * DAY, label: "30 days" },
  { value: 90 * DAY, label: "90 days" },
  { value: 180 * DAY, label: "180 days" },
  { value: 365 * DAY, label: "1 year" },
];

// Binary GB (1 GB = 1024^3), matching the server's 2 GB default.
export const ZIP_LIMIT: Choice[] = [
  { value: 500 * MB, label: "500 MB" },
  { value: GB, label: "1 GB" },
  { value: 2 * GB, label: "2 GB" },
  { value: 5 * GB, label: "5 GB" },
  { value: 10 * GB, label: "10 GB" },
];

export const CACHE_SIZE: Choice[] = [
  { value: GB, label: "1 GB" },
  { value: 5 * GB, label: "5 GB" },
  { value: 20 * GB, label: "20 GB" },
  { value: 50 * GB, label: "50 GB" },
];

// Minutes. 0 is the server's "never check by itself".
export const CHECK_INTERVAL: Choice[] = [
  { value: 5, label: "Every 5 minutes" },
  { value: 15, label: "Every 15 minutes" },
  { value: 60, label: "Every hour" },
  { value: 1440, label: "Every day" },
  { value: 0, label: "Only when I ask" },
];

export const STABLE_WAIT: Choice[] = [
  { value: 0, label: "No wait" },
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
];

export interface PictureQuality {
  label: string;
  thumb_size_grid: number;
  thumb_size_grid2x: number;
  thumb_size_preview: number;
  thumb_quality: number;
}

// Standard equals the server defaults (media.SIZES, media.DEFAULT_QUALITY).
export const PICTURE_QUALITY: PictureQuality[] = [
  { label: "Standard", thumb_size_grid: 300, thumb_size_grid2x: 600, thumb_size_preview: 1600, thumb_quality: 82 },
  { label: "High", thumb_size_grid: 400, thumb_size_grid2x: 800, thumb_size_preview: 2400, thumb_quality: 90 },
];

/** The ready choice closest to a stored value. Ties go to the first (smaller) choice. */
export function nearestChoice(choices: Choice[], stored: number): Choice {
  return choices.reduce((best, c) => (Math.abs(c.value - stored) < Math.abs(best.value - stored) ? c : best));
}

export function nearestPicture(s: {
  thumb_size_grid: number;
  thumb_size_grid2x: number;
  thumb_size_preview: number;
  thumb_quality: number;
}): PictureQuality {
  const distance = (p: PictureQuality) =>
    Math.abs(p.thumb_size_grid - s.thumb_size_grid) / p.thumb_size_grid +
    Math.abs(p.thumb_size_grid2x - s.thumb_size_grid2x) / p.thumb_size_grid2x +
    Math.abs(p.thumb_size_preview - s.thumb_size_preview) / p.thumb_size_preview +
    Math.abs(p.thumb_quality - s.thumb_quality) / p.thumb_quality;
  return PICTURE_QUALITY.reduce((best, p) => (distance(p) < distance(best) ? p : best));
}

export function matchesPicture(p: PictureQuality, s: Record<string, number>): boolean {
  return (
    p.thumb_size_grid === s.thumb_size_grid &&
    p.thumb_size_grid2x === s.thumb_size_grid2x &&
    p.thumb_size_preview === s.thumb_size_preview &&
    p.thumb_quality === s.thumb_quality
  );
}

/** Exact stored value as a sentence for the (i), e.g. "It is currently set to 3 days, 4 hours." */
export function exactNote(kind: "seconds" | "bytes" | "minutes", stored: number): string {
  if (kind === "seconds") return `It is currently set to ${formatDuration(stored)} (${stored.toLocaleString("en")} seconds), which is not one of the choices; it stays as it is until you pick a choice.`;
  if (kind === "minutes") return `It is currently set to ${stored.toLocaleString("en")} minutes, which is not one of the choices; it stays as it is until you pick a choice.`;
  return `It is currently set to ${stored.toLocaleString("en")} bytes, which is not one of the choices; it stays as it is until you pick a choice.`;
}
