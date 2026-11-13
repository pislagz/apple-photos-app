import { useEffect, useState } from "react";
import { type LibraryResponse, replaceLibrary, type ReplacePreview, type ReplaceSuggestion } from "../api";
import { describeError } from "../sharing";
import { GroupedList, Row } from "../ui/GroupedList";
import Sheet from "../ui/Sheet";
import LibraryPicker, { type PickedFile } from "./LibraryPicker";

// Warnings that need an explicit "Replace Anyway". The server does not count
// originals_missing as a blocker, so neither do we.
const INFO_ONLY_CODES = new Set(["originals_missing"]);

const stripSuffix = (name: string) => name.replace(/\.photoslibrary$/i, "");

// Two steps in one sheet: choose the new file (the server's suggestions first), then see
// what would change and confirm. Nothing happens until the last button.
export default function ReplaceDialog({
  library,
  initial,
  suggestions = [],
  onClose,
  onReplaced,
}: {
  library: LibraryResponse;
  /** A file to preview straight away, for example the server's suggestion. */
  initial?: PickedFile;
  suggestions?: ReplaceSuggestion[];
  onClose: () => void;
  onReplaced: () => void;
}) {
  const [picked, setPicked] = useState<PickedFile | null>(initial ?? null);
  const [typedPath, setTypedPath] = useState("");
  const [preview, setPreview] = useState<ReplacePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A preview belongs to the file it was made for: choosing another file starts over.
  useEffect(() => {
    if (picked === null) return;
    let cancelled = false;
    setPreview(null);
    setError(null);
    setBusy(true);
    replaceLibrary(library.id, picked.path)
      .then((result) => !cancelled && setPreview(result))
      .catch((err: unknown) => !cancelled && setError(describeError(err)))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [picked, library.id]);

  const blockers = preview?.warnings.filter((w) => !INFO_ONLY_CODES.has(w.code)) ?? [];
  const anyway = blockers.length > 0;

  async function confirm() {
    if (picked === null) return;
    setError(null);
    setBusy(true);
    try {
      await replaceLibrary(library.id, picked.path, { confirm: true, replaceAnyway: anyway });
      onReplaced();
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  const errorLine = error && (
    <p role="alert" className="admin-sheet__error">
      {error}
    </p>
  );

  if (picked === null) {
    return (
      <Sheet title="Replace Library File" cancelLabel="Close" onClose={onClose} actions={[]}>
        <p>Choose the new file for “{library.display_name}”. Its name, who can see it and its settings stay the same.</p>
        {errorLine}
        <LibraryPicker
          refreshKey={0}
          buttonLabel="Choose"
          suggestions={suggestions}
          onError={setError}
          onPick={(file) => setPicked(file)}
        >
          <form
            className="admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              setPicked({ path: typedPath.trim(), name: typedPath.trim() });
            }}
          >
            <label className="admin-field">
              New path
              <input className="admin-input" value={typedPath} onChange={(event) => setTypedPath(event.target.value)} placeholder="/libraries/Alice 2026.photoslibrary" />
            </label>
            <button type="submit" className="admin-btn" disabled={typedPath.trim() === ""}>
              Preview
            </button>
          </form>
        </LibraryPicker>
      </Sheet>
    );
  }

  const title = `Replace “${library.display_name}” with “${stripSuffix(picked.name.split("/").pop() ?? picked.name)}”?`;
  return (
    <Sheet
      title={title}
      onClose={onClose}
      actions={[
        {
          label: anyway ? "Replace Anyway" : "Replace",
          kind: anyway ? "destructive" : "neutral",
          disabled: busy || preview === null,
          onClick: () => void confirm(),
        },
      ]}
    >
      {errorLine}
      {preview === null && !error && <p role="status">Looking at the new file…</p>}
      {preview === null && error && (
        <button type="button" className="admin-btn" onClick={() => setPicked(null)}>
          Choose a Different File
        </button>
      )}
      {preview && (
        <>
          <GroupedList label="Replace preview">
            <Row label="In the new file" value={`${preview.new_asset_count.toLocaleString()} photos`} />
            <Row label="Will be added" value={preview.would_add.toLocaleString()} />
            <Row label="Will be removed" value={preview.would_remove.toLocaleString()} />
            <Row label="Already in this library" value={`${Math.round(preview.overlap * 100)}%`} />
            <Row
              label="Same library as before"
              value={preview.store_uuid_match === null ? "Can't tell" : preview.store_uuid_match ? "Yes" : "No"}
            />
          </GroupedList>
          {preview.warnings.map((warning) => (
            <p key={warning.code} role="alert" className="admin-hint admin-hint--warn">
              {warning.message}
            </p>
          ))}
          {anyway && (
            <p className="admin-hint">
              These look like different libraries. Anyone who had photos in the old one may lose them from their view.
            </p>
          )}
          <button type="button" className="admin-btn" onClick={() => setPicked(null)}>
            Choose a Different File
          </button>
        </>
      )}
    </Sheet>
  );
}
