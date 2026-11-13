import { useEffect, useState } from "react";
import {
  ApiError,
  addLibraryFolder,
  candidateSize,
  listLibraryCandidates,
  removeLibraryFolder,
  type LibraryCandidate,
  type LibraryCandidates,
} from "../api";

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "something went wrong";
}

export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

function rowStatus(candidate: LibraryCandidate, size: number | undefined): string {
  const parts: string[] = [];
  if (candidate.status === "ready") {
    parts.push("Ready");
    if (candidate.asset_count !== null) parts.push(`${candidate.asset_count} ${candidate.asset_count === 1 ? "photo" : "photos"}`);
  } else if (candidate.status === "cannot_open") {
    parts.push("Can't be opened");
  } else {
    parts.push("Not added yet");
  }
  parts.push(size === undefined ? "Measuring size…" : formatSize(size));
  return parts.join(" · ");
}

// Folders that hold libraries, and every library package found in them.
// `onPick` adds the chosen package; `refreshKey` reloads after a change.
export default function LibraryPicker({
  onPick,
  refreshKey,
  onError,
}: {
  onPick: (candidate: LibraryCandidate) => void;
  refreshKey: number;
  onError: (message: string | null) => void;
}) {
  const [data, setData] = useState<LibraryCandidates | null>(null);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [folderPath, setFolderPath] = useState("");

  function load() {
    listLibraryCandidates()
      .then(setData)
      .catch((err: unknown) => onError(describeError(err)));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [refreshKey]);

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
      load();
    } catch (err) {
      onError(describeError(err));
    }
  }

  async function handleRemoveFolder(path: string) {
    if (!window.confirm(`Stop looking for libraries in ${path}? Libraries you already added stay, and no files are deleted.`)) return;
    onError(null);
    try {
      await removeLibraryFolder(path);
      load();
    } catch (err) {
      onError(describeError(err));
    }
  }

  if (!data) return null;
  return (
    <div className="library-picker">
      <h2>Libraries found</h2>
      {data.candidates.length === 0 ? (
        <p>
          {data.folders.length === 0
            ? "No libraries found. Add a folder that contains your Photos libraries."
            : "No libraries found in your folders. Check that the drive is connected, or add another folder."}
        </p>
      ) : (
        <ul aria-label="Libraries found" className="library-picker-list">
          {data.candidates.map((candidate) => (
            <li key={candidate.path}>
              <div>
                <strong>{candidate.registered ? (candidate.library_name ?? candidate.name) : candidate.name}</strong>
                <span>{rowStatus(candidate, sizes[candidate.path])}</span>
              </div>
              {candidate.registered ? (
                <span>Already added</span>
              ) : (
                <button type="button" disabled={candidate.status === "cannot_open"} onClick={() => onPick(candidate)}>
                  Add {candidate.name}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>Folders with libraries</h2>
      {data.folders.length > 0 && (
        <ul aria-label="Folders with libraries">
          {data.folders.map((folder) => (
            <li key={folder.path}>
              <code>{folder.path}</code>
              {!folder.reachable && <span> · Can't be read. Is the drive connected?</span>}{" "}
              <button type="button" onClick={() => handleRemoveFolder(folder.path)}>
                Remove folder {folder.path}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleAddFolder}>
        <label>
          Add a folder that contains your libraries
          <input value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder="/Volumes/Photos" />
        </label>
        <button type="submit" disabled={folderPath.trim() === ""}>
          Add folder
        </button>
      </form>
    </div>
  );
}
