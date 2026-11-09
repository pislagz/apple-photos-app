import { useState } from "react";
import { ApiError, replaceLibrary, type LibraryResponse, type ReplacePreview } from "../api";

// Warnings that need an explicit "Replace anyway". The server does not count
// originals_missing as a blocker, so neither do we.
const INFO_ONLY_CODES = new Set(["originals_missing"]);

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "something went wrong";
}

export default function ReplaceDialog({
  library,
  initialPath = "",
  onClose,
  onReplaced,
}: {
  library: LibraryResponse;
  initialPath?: string;
  onClose: () => void;
  onReplaced: () => void;
}) {
  const [path, setPath] = useState(initialPath);
  const [preview, setPreview] = useState<ReplacePreview | null>(null);
  const [anyway, setAnyway] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const blockers = preview?.warnings.filter((w) => !INFO_ONLY_CODES.has(w.code)) ?? [];

  async function handlePreview(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPreview(null);
    setAnyway(false);
    setBusy(true);
    try {
      setPreview(await replaceLibrary(library.id, path.trim()));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    setError(null);
    setBusy(true);
    try {
      await replaceLibrary(library.id, path.trim(), { confirm: true, replaceAnyway: anyway });
      onReplaced();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-label={`Replace library file for ${library.display_name}`}>
      <h2>Replace library file: {library.display_name}</h2>
      <p>
        Points this library at a new package. Its id, name, sharing and settings stay; photos are matched by their
        Photos id. Currently: {library.path}
      </p>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={handlePreview}>
        <label>
          New path
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/libraries/Alice 2026.photoslibrary" />
        </label>
        <button type="submit" disabled={busy || path.trim() === ""}>
          Preview
        </button>
      </form>

      {preview && (
        <div>
          <ul aria-label="Replace preview">
            <li>{preview.new_asset_count} photos in the new file</li>
            <li>{preview.would_add} would be added</li>
            <li>{preview.would_remove} would be removed</li>
            <li>{Math.round(preview.overlap * 100)}% of the current photos are in the new file</li>
            <li>
              Same library store:{" "}
              {preview.store_uuid_match === null ? "unknown" : preview.store_uuid_match ? "yes" : "no"}
            </li>
          </ul>
          {preview.warnings.map((warning) => (
            <p key={warning.code} role="alert">
              {warning.message}
            </p>
          ))}
          {blockers.length > 0 && (
            <label>
              <input type="checkbox" checked={anyway} onChange={(event) => setAnyway(event.target.checked)} />
              Replace anyway
            </label>
          )}
          <button type="button" onClick={handleConfirm} disabled={busy || (blockers.length > 0 && !anyway)}>
            {blockers.length > 0 ? "Replace anyway" : "Replace"}
          </button>
        </div>
      )}
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
