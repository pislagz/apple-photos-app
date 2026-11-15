// Plain-words view of a library's status response, for the Libraries screen.
// Nothing here returns a raw timestamp, a byte count or a path.
import type { LibraryStatusResponse, RunSummary } from "./api";
import { formatBytes } from "./ui/format";

export type StatusKind = "loading" | "ready" | "indexing" | "updating" | "attention" | "missing" | "cannot_open";

const MISSING_CODES = new Set(["drive_not_mounted", "unreadable", "library_open"]);

export function isIndexing(status: LibraryStatusResponse | undefined): boolean {
  if (!status) return false;
  return status.index_state === "indexing" || (!status.last_indexed_at && status.index_state !== "error");
}

export function statusKind(status: LibraryStatusResponse | undefined): StatusKind {
  if (!status) return "loading";
  if (status.warnings.some((w) => w.code === "unsupported_version")) return "cannot_open";
  if (status.warnings.some((w) => MISSING_CODES.has(w.code)) || status.suggestion) return "missing";
  if (isIndexing(status)) return "indexing";
  if (status.index_state === "error") return "attention";
  if (status.updating) return "updating";
  if (status.warnings.length > 0) return "attention";
  return "ready";
}

const WORDS: Record<StatusKind, string> = {
  loading: "Checking…",
  ready: "Ready",
  indexing: "Reading photos…",
  updating: "Updating…",
  attention: "Needs attention",
  missing: "Not found",
  cannot_open: "Can't open",
};

export function statusWord(status: LibraryStatusResponse | undefined): string {
  return WORDS[statusKind(status)];
}

export function photoCount(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "photo" : "photos"}`;
}

/** "Ready · 20 photos · 412 GB" — the pieces that are known, in that order. */
export function rowSummary(status: LibraryStatusResponse | undefined): string {
  const kind = statusKind(status);
  const parts = [WORDS[kind]];
  if (status && kind !== "indexing" && status.asset_count !== null) parts.push(photoCount(status.asset_count));
  if (status && kind !== "indexing" && status.total_size_bytes !== null && status.total_size_bytes > 0) {
    parts.push(formatBytes(status.total_size_bytes));
  }
  if (status && kind === "indexing" && status.index_progress && status.index_progress.total > 0) {
    parts.push(`${status.index_progress.done.toLocaleString()} of ${status.index_progress.total.toLocaleString()} photos`);
  }
  return parts.join(" · ");
}

// Server warnings that name paths or use technical words, in plain words.
const WARNING_TEXT: Record<string, string> = {
  drive_not_mounted: "The drive with this library isn't connected. Connect it and check again.",
  library_open: "This library can't be opened right now. Check that its drive is connected.",
  unreadable: "This library can't be opened right now. Check that its drive is connected.",
  unsupported_version: "This library was made by a version of Photos this app can't read yet.",
  update_stuck: "An update has been waiting for a long time. Check that nothing is still copying into the library.",
};

export function warningText(warning: { code: string; message: string }): string {
  return WARNING_TEXT[warning.code] ?? warning.message;
}

const OUTCOME_WORDS: Record<string, string> = { applied: "Updated", failed: "Update failed", not_ready: "Not ready yet" };

function plainReason(error: string | null): string | null {
  if (!error) return null;
  // Errors from the server can carry paths; keep only the first sentence's words.
  return error.replace(/\/\S+/g, "the library").slice(0, 160);
}

/** One line per update, without the raw timestamp: "Updated · 12 photos added, 3 removed". */
export function runSentence(run: RunSummary): string {
  const head = OUTCOME_WORDS[run.outcome] ?? "Update";
  if (run.outcome === "applied") {
    const bits: string[] = [];
    if (run.added) bits.push(`${run.added.toLocaleString()} added`);
    if (run.removed) bits.push(`${run.removed.toLocaleString()} removed`);
    if (run.changed) bits.push(`${run.changed.toLocaleString()} changed`);
    return bits.length === 0 ? `${head}. No changes.` : `${head}. ${bits.join(", ")}.`;
  }
  const reason = plainReason(run.error);
  return reason ? `${head}. ${reason}` : `${head}.`;
}

export const TRIGGER_WORDS: Record<string, string> = { auto: "Checked automatically", manual: "Checked by you" };
