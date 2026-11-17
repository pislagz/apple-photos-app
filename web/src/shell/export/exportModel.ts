import { formatBytes } from "../library/zipDownload";
import type { TransferFormat } from "./transferFormat";

export type ExportFormat = "original" | "jpeg";
export type ExportMethod = "share" | "folder" | "zip";

export interface ExportItem {
  id: string;
  filename: string | null;
  original_filename?: string | null;
  is_video?: boolean;
  is_live_photo?: boolean;
  is_heic?: boolean;
}

export function formatFor(pref: TransferFormat): ExportFormat {
  return pref === "original" ? "original" : "jpeg";
}

// No browser documents a share-sheet limit. The files all sit in memory as
// Blobs until the sheet has taken them, and iOS Safari / an installed web app
// get killed when that is too much; a few hundred MB is where it gets
// unreliable in practice. These are conservative, and a refusal always offers
// a ZIP instead of splitting the selection.
export const SHARE_MAX_BYTES = 300 * 1024 * 1024;
export const SHARE_MAX_FILES = 100;

export type ExportState =
  | { phase: "idle" }
  | { phase: "working"; method: ExportMethod; items: ExportItem[]; fileIndex: number; fileCount: number; received: number }
  // The browser wants a fresh tap before it opens the share sheet.
  | { phase: "ready"; items: ExportItem[]; files: File[]; hint?: string }
  | { phase: "blocked"; items: ExportItem[]; message: string }
  | { phase: "error"; method: ExportMethod; items: ExportItem[]; message: string }
  | { phase: "done"; method: ExportMethod; saved: number; folder?: string };

export type ExportAction =
  | { type: "start"; method: ExportMethod; items: ExportItem[]; fileCount: number }
  | { type: "progress"; fileIndex: number; received: number }
  | { type: "ready"; items: ExportItem[]; files: File[] }
  | { type: "hint"; hint: string }
  | { type: "done"; method: ExportMethod; saved: number; folder?: string }
  | { type: "blocked"; items: ExportItem[]; message: string }
  | { type: "error"; method: ExportMethod; items: ExportItem[]; message: string }
  | { type: "close" };

export const IDLE: ExportState = { phase: "idle" };

export function exportReducer(state: ExportState, action: ExportAction): ExportState {
  switch (action.type) {
    case "start":
      return { phase: "working", method: action.method, items: action.items, fileIndex: 0, fileCount: action.fileCount, received: 0 };
    case "progress":
      return state.phase === "working" ? { ...state, fileIndex: action.fileIndex, received: action.received } : state;
    case "ready":
      return { phase: "ready", items: action.items, files: action.files };
    case "hint":
      return state.phase === "ready" ? { ...state, hint: action.hint } : state;
    case "done":
      return { phase: "done", method: action.method, saved: action.saved, folder: action.folder };
    case "blocked":
      return { phase: "blocked", items: action.items, message: action.message };
    case "error":
      return { phase: "error", method: action.method, items: action.items, message: action.message };
    case "close":
      return IDLE;
  }
}

export function countLabel(count: number): string {
  return `${count} ${count === 1 ? "Item" : "Items"}`;
}

// Why the share sheet should not be tried for this selection (null: fine).
export function shareBlockReason(count: number, bytes: number | null, format: ExportFormat): string | null {
  if (count > SHARE_MAX_FILES) {
    return `${count} items are too many for one share sheet (up to ${SHARE_MAX_FILES} work reliably).`;
  }
  // JPEG sizes are not known up front; the fetch enforces the cap by real bytes.
  if (format === "original" && bytes !== null && bytes > SHARE_MAX_BYTES) {
    return `About ${formatBytes(bytes)} is too large for one share sheet (the limit is about ${formatBytes(SHARE_MAX_BYTES)}).`;
  }
  return null;
}

// "IMG_1.HEIC" taken -> "IMG_1 (1).HEIC". Case-insensitive like Mac volumes.
export function uniqueName(name: string, taken: Set<string>): string {
  const key = (value: string) => value.toLowerCase();
  let candidate = name;
  if (taken.has(key(candidate))) {
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let n = 1;
    do {
      candidate = `${stem} (${n})${ext}`;
      n += 1;
    } while (taken.has(key(candidate)));
  }
  taken.add(key(candidate));
  return candidate;
}
