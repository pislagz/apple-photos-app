import { type ReactNode, useEffect, useState } from "react";
import InfoButton from "../../help/InfoButton";
import {
  addLibraryFolder,
  candidateSize,
  listLibraryCandidates,
  removeLibraryFolder,
  type LibraryCandidate,
  type LibraryCandidates,
} from "../api";
import { describeError } from "../sharing";
import { Footer, GroupedList, Row } from "../ui/GroupedList";
import Sheet from "../ui/Sheet";
import { formatBytes } from "../ui/format";

export interface PickedFile {
  path: string;
  name: string;
}

/** Shown when no folder is connected yet. Also used by the empty Libraries screen. */
export function ConnectHelp() {
  return (
    <details className="admin-advanced admin-help-details">
      <summary>How do I connect a folder?</summary>
      <p>
        The folder with your Photos libraries has to be connected to the computer that runs this app first. With Docker, add the
        folder in <code>docker-compose.yml</code> under <code>volumes</code>, for example <code>/path/to/photos:/libraries:ro</code>,
        then restart. On a Mac, just type the folder's location below, for example <code>/Volumes/Photos</code>.
      </p>
    </details>
  );
}

function rowStatus(candidate: LibraryCandidate, size: number | undefined): string {
  const parts: string[] = [];
  if (candidate.status === "ready") {
    parts.push("Ready");
    if (candidate.asset_count !== null) parts.push(`${candidate.asset_count.toLocaleString()} ${candidate.asset_count === 1 ? "photo" : "photos"}`);
  } else if (candidate.status === "cannot_open") {
    parts.push("Can't be opened");
  } else {
    parts.push("Not added yet");
  }
  parts.push(size === undefined ? "Measuring size…" : formatBytes(size));
  return parts.join(" · ");
}

// Folders that hold libraries, and every library package found in them. The same list
// serves Add (`buttonLabel` "Add") and Replace ("Choose"). `suggestions` are pinned first.
// `children` is the typed-path form, shown under Advanced.
export default function LibraryPicker({
  onPick,
  refreshKey,
  onError,
  buttonLabel = "Add",
  suggestions = [],
  children,
}: {
  onPick: (file: PickedFile) => void;
  refreshKey: number;
  onError: (message: string | null) => void;
  buttonLabel?: string;
  suggestions?: Array<PickedFile & { message?: string }>;
  children?: ReactNode;
}) {
  const [data, setData] = useState<LibraryCandidates | null>(null);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [folderPath, setFolderPath] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    listLibraryCandidates()
      .then(setData)
      .catch((err: unknown) => onError(describeError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, reload]);

  // Sizes are measured one package at a time so the list itself appears at once.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    (async () => {
      for (const candidate of data.candidates) {
        if (cancelled) return;
        try {
          const result = await candidateSize(candidate.path);
          if (result.size_bytes !== null && !cancelled) {
            setSizes((prev) => ({ ...prev, [candidate.path]: result.size_bytes as number }));
          }
        } catch {
          // The row keeps saying "Measuring size…" until the next reload.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  async function handleAddFolder(event: React.FormEvent) {
    event.preventDefault();
    onError(null);
    try {
      await addLibraryFolder(folderPath);
      setFolderPath("");
      setReload((n) => n + 1);
    } catch (err) {
      onError(describeError(err));
    }
  }

  async function handleRemoveFolder(path: string) {
    setRemoving(null);
    onError(null);
    try {
      await removeLibraryFolder(path);
      setReload((n) => n + 1);
    } catch (err) {
      onError(describeError(err));
    }
  }

  if (!data) return null;
  const suggested = new Set(suggestions.map((s) => s.path));
  const candidates = data.candidates.filter((c) => !suggested.has(c.path));
  return (
    <div className="library-picker">
      {suggestions.length > 0 && (
        <GroupedList heading="Suggested" label="Suggested libraries">
          {suggestions.map((s) => (
            <Row
              key={s.path}
              label={s.name}
              detail={s.message}
              control={
                <button type="button" className="admin-btn admin-btn--primary" aria-label={`${buttonLabel} ${s.name}`} onClick={() => onPick(s)}>
                  {buttonLabel}
                </button>
              }
            />
          ))}
        </GroupedList>
      )}

      {candidates.length === 0 && suggestions.length === 0 ? (
        <>
          <p className="admin-hint">
            {data.folders.length === 0
              ? "No libraries found. Add a folder that contains your Photos libraries."
              : "No libraries found in your folders. Check that the drive is connected, or add another folder."}
          </p>
          <ConnectHelp />
        </>
      ) : (
        candidates.length > 0 && (
          <GroupedList heading="Libraries found" label="Libraries found">
            {candidates.map((candidate) => (
              <Row
                key={candidate.path}
                label={candidate.registered ? (candidate.library_name ?? candidate.name) : candidate.name}
                detail={rowStatus(candidate, sizes[candidate.path])}
                control={
                  candidate.registered ? (
                    <span className="admin-row__value">Already added</span>
                  ) : (
                    <button
                      type="button"
                      className="admin-btn"
                      aria-label={`${buttonLabel} ${candidate.name}`}
                      disabled={candidate.status === "cannot_open"}
                      onClick={() => onPick(candidate)}
                    >
                      {buttonLabel}
                    </button>
                  )
                }
              />
            ))}
          </GroupedList>
        )
      )}

      <GroupedList
        heading="Folders with libraries"
        label="Folders with libraries"
        footer="Libraries are looked for inside these folders on the computer that runs this app. Removing a folder deletes no files."
      >
        {data.folders.map((folder) => (
          <Row
            key={folder.path}
            label={folder.path}
            detail={folder.reachable ? undefined : "Can't be read. Is the drive connected?"}
            control={
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                aria-label={`Remove folder ${folder.path}`}
                onClick={() => setRemoving(folder.path)}
              >
                Remove
              </button>
            }
          />
        ))}
        <form onSubmit={handleAddFolder} role="listitem" className="admin-row admin-row--form">
          <span className="admin-row__text">
            <span className="admin-row__label">
              <label htmlFor="library-folder-path">Add a folder</label> <InfoButton helpKey="libFolders" name="folders with libraries" />
            </span>
          </span>
          <span className="admin-row__control">
            <input
              id="library-folder-path"
              className="admin-input"
              value={folderPath}
              onChange={(event) => setFolderPath(event.target.value)}
              placeholder="/Volumes/Photos"
            />
            <button type="submit" className="admin-btn" disabled={folderPath.trim() === ""}>
              Add Folder
            </button>
          </span>
        </form>
      </GroupedList>

      {children !== undefined && (
        <details className="admin-advanced">
          <summary>Advanced</summary>
          {children}
        </details>
      )}
      <Footer>Libraries are read-only here. Nothing in a library is ever changed.</Footer>

      {removing !== null && (
        <Sheet
          title="Stop looking in this folder?"
          onClose={() => setRemoving(null)}
          actions={[{ label: "Remove Folder", kind: "destructive", onClick: () => void handleRemoveFolder(removing) }]}
        >
          <p>
            Libraries you already added stay. No files are deleted. You can add the folder again later.
          </p>
          <p className="admin-hint">{removing}</p>
        </Sheet>
      )}
    </div>
  );
}
