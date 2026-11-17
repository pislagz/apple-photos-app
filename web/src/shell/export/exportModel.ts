import { formatBytes } from "../library/zipDownload";

export type ExportFormat = "original" | "jpeg";
export type ExportMethod = "share" | "folder" | "individual";

export interface ExportItem {
  id: string;
  filename: string | null;
  original_filename?: string | null;
  is_video?: boolean;
  is_live_photo?: boolean;
  is_heic?: boolean;
}

// No browser documents a share-sheet limit. The files all sit in memory as
// Blobs until the sheet has taken them, and iOS Safari / an installed web app
// get killed when that is too much; a few hundred MB is where it gets
// unreliable in practice. These are conservative, and a refusal always offers
// another method instead of splitting the selection.
export const SHARE_MAX_BYTES = 300 * 1024 * 1024;
export const SHARE_MAX_FILES = 100;

export type ExportState =
  | { phase: "idle" }
  | { phase: "choosing"; items: ExportItem[]; format: ExportFormat; bytes: number | null }
  | {
      phase: "working";
      method: ExportMethod;
      items: ExportItem[];
      format: ExportFormat;
      fileIndex: number;
      fileCount: number;
      received: number;
    }
  | { phase: "ready"; items: ExportItem[]; format: ExportFormat; files: File[]; hint?: string }
  | { phase: "done"; method: ExportMethod | "shared"; saved: number; folder?: string }
  | { phase: "blocked"; items: ExportItem[]; format: ExportFormat; message: string }
  | { phase: "error"; items: ExportItem[]; format: ExportFormat; message: string };

export type ExportAction =
  | { type: "open"; items: ExportItem[] }
  | { type: "size"; bytes: number | null }
  | { type: "format"; format: ExportFormat }
  | { type: "start"; method: ExportMethod; fileCount: number }
  | { type: "progress"; fileIndex: number; received: number }
  | { type: "ready"; files: File[] }
  | { type: "hint"; hint: string }
  | { type: "done"; method: ExportMethod | "shared"; saved: number; folder?: string }
  | { type: "blocked"; message: string }
  | { type: "error"; message: string }
  | { type: "back" }
  | { type: "close" };

export const IDLE: ExportState = { phase: "idle" };

// The three screens that can go back to the choice (with the same selection).
function itemsOf(state: ExportState): ExportItem[] | null {
  return "items" in state ? state.items : null;
}

export function exportReducer(state: ExportState, action: ExportAction): ExportState {
  switch (action.type) {
    case "open":
      return { phase: "choosing", items: action.items, format: "original", bytes: null };
    case "close":
      return IDLE;
    case "size":
      return state.phase === "choosing" ? { ...state, bytes: action.bytes } : state;
    case "format":
      return state.phase === "choosing" ? { ...state, format: action.format } : state;
    case "start":
      if (state.phase !== "choosing") return state;
      return { phase: "working", method: action.method, items: state.items, format: state.format, fileIndex: 0, fileCount: action.fileCount, received: 0 };
    case "progress":
      return state.phase === "working" ? { ...state, fileIndex: action.fileIndex, received: action.received } : state;
    case "ready":
      return state.phase === "working" ? { phase: "ready", items: state.items, format: state.format, files: action.files } : state;
    case "hint":
      return state.phase === "ready" ? { ...state, hint: action.hint } : state;
    case "done":
      return { phase: "done", method: action.method, saved: action.saved, folder: action.folder };
    case "blocked":
    case "error": {
      const items = itemsOf(state);
      const format = "format" in state ? state.format : "original";
      if (!items) return state;
      return { phase: action.type, items, format, message: action.message };
    }
    case "back": {
      const items = itemsOf(state);
      if (!items) return IDLE;
      const format = "format" in state ? state.format : "original";
      return { phase: "choosing", items, format, bytes: null };
    }
  }
}

// What the choice step says about the selection: "12 items · about 48 MB".
export function describeSelection(count: number, bytes: number | null): string {
  const noun = `${count} ${count === 1 ? "item" : "items"}`;
  return bytes && bytes > 0 ? `${noun} · about ${formatBytes(bytes)}` : noun;
}

// Why the share sheet should not be tried for this selection (null: fine).
export function shareBlockReason(count: number, bytes: number | null, format: ExportFormat): string | null {
  if (count > SHARE_MAX_FILES) {
    return `${count} items is too many for one share sheet (up to ${SHARE_MAX_FILES} work reliably).`;
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
