import type { AssetDetailResponse } from "../../api";

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

// `place_address` is osxphotos' full formatted address; `place` is its
// shorter place name. Prefer the fuller one, fall back to the other.
export function formatLocationLine(detail: Pick<AssetDetailResponse, "place" | "place_address">): string {
  return detail.place_address || detail.place || "";
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
