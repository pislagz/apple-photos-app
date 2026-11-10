import type { AssetDetailResponse, SelectionSummary } from "../../api";

// `date_created` is a naive "YYYY-MM-DDTHH:MM:SS" string (no offset) --
// parsed as UTC, like grouping.ts's `formatGroupLabel`, so the displayed
// clock time matches what's stored instead of shifting with the browser's
// own timezone.
export function formatDateLine(iso: string | null): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  return date.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" });
}

export function formatCameraLine(detail: Pick<AssetDetailResponse, "camera_make" | "camera_model">): string {
  return [detail.camera_make, detail.camera_model].filter(Boolean).join(" ");
}

// 52.2297° N, 21.0122° E. Null when either value is missing or out of range.
export function formatCoordinates(latitude: number | null, longitude: number | null): string | null {
  if (latitude == null || longitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const lat = `${Math.abs(latitude).toFixed(4)}° ${latitude < 0 ? "S" : "N"}`;
  const lon = `${Math.abs(longitude).toFixed(4)}° ${longitude < 0 ? "W" : "E"}`;
  return `${lat}, ${lon}`;
}

// The one place label (viewer title, Info "Location"). The text is the
// record Photos stored in the library (`place_address`, osxphotos' full
// formatted address, else `place`, its shorter name), shown unchanged.
// Nothing is ever geocoded: with GPS and no record it is the coordinates
// ("Unknown place" if they are unusable); with no GPS either, empty.
export function formatLocationLine(
  detail: Pick<AssetDetailResponse, "place" | "place_address" | "latitude" | "longitude">,
): string {
  const named = detail.place_address || detail.place;
  if (named) return named;
  if (detail.latitude == null && detail.longitude == null) return "";
  return formatCoordinates(detail.latitude, detail.longitude) ?? "Unknown place";
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export interface InfoRow {
  label: string;
  value: string;
}

// Shared by the mobile info sheet and the desktop info panel -- the desktop
// panel additionally shows file name and size (`includeFile`), the mobile
// sheet does not.
export function buildInfoRows(detail: AssetDetailResponse, options: { includeFile?: boolean } = {}): InfoRow[] {
  const rows: InfoRow[] = [];
  const date = formatDateLine(detail.date_created);
  if (date) rows.push({ label: "Date", value: date });
  const camera = formatCameraLine(detail);
  if (camera) rows.push({ label: "Camera", value: camera });
  if (detail.people.length > 0) rows.push({ label: "People", value: detail.people.join(", ") });
  if (detail.albums.length > 0) rows.push({ label: "Albums", value: detail.albums.join(", ") });
  const location = formatLocationLine(detail);
  if (location) rows.push({ label: "Location", value: location });
  if (options.includeFile) {
    const filename = detail.original_filename || detail.filename;
    if (filename) rows.push({ label: "Filename", value: filename });
    const size = formatFileSize(detail.original_filesize);
    if (size) rows.push({ label: "Size", value: size });
  }
  return rows;
}

// D21: "3–9 Mar 2024", "28 Feb – 3 Mar 2024", "28 Dec 2023 – 3 Jan 2024".
// Dates are the stored naive strings read as UTC (see `formatDateLine`).
export function formatDateRange(first: string | null, last: string | null): string {
  const parse = (iso: string | null) => {
    const match = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
    return match ? { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) } : null;
  };
  const a = parse(first);
  const b = parse(last);
  if (!a && !b) return "";
  const from = a ?? (b as NonNullable<typeof b>);
  const to = b ?? from;
  const month = (m: number) => new Date(Date.UTC(2000, m, 1)).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
  if (from.year === to.year && from.month === to.month) {
    const days = from.day === to.day ? `${from.day}` : `${from.day}–${to.day}`;
    return `${days} ${month(from.month)} ${from.year}`;
  }
  if (from.year === to.year) {
    return `${from.day} ${month(from.month)} – ${to.day} ${month(to.month)} ${from.year}`;
  }
  return `${from.day} ${month(from.month)} ${from.year} – ${to.day} ${month(to.month)} ${to.year}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// Info rows for a multi-selection (desktop panel): item count (split when it
// mixes photos and videos), date range, total size, and the place only when
// every selected item shares one.
export function buildSelectionRows(summary: SelectionSummary): InfoRow[] {
  const items =
    summary.photos > 0 && summary.videos > 0
      ? `${summary.count} items (${plural(summary.photos, "photo", "photos")}, ${plural(summary.videos, "video", "videos")})`
      : summary.videos > 0
        ? plural(summary.videos, "video", "videos")
        : plural(summary.photos, "photo", "photos");
  const rows: InfoRow[] = [{ label: "Selected", value: items }];
  const range = formatDateRange(summary.date_first, summary.date_last);
  if (range) rows.push({ label: "Date", value: range });
  const size = formatFileSize(summary.total_bytes);
  if (size) rows.push({ label: "Size", value: size });
  if (summary.place) rows.push({ label: "Location", value: summary.place });
  return rows;
}
