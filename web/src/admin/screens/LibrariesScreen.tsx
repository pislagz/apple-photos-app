import { useEffect, useState } from "react";
import PrewarmControls from "./PrewarmControls";
import ReplaceDialog from "./ReplaceDialog";
import {
  ApiError,
  addLibrary,
  libraryStatus,
  listLibraries,
  type LibraryResponse,
  type LibraryStatusResponse,
  reindexLibrary,
  removeLibrary,
  renameLibrary,
} from "../api";

export default function LibrariesScreen() {
  const [libraries, setLibraries] = useState<LibraryResponse[]>([]);
  const [statuses, setStatuses] = useState<Record<number, LibraryStatusResponse>>({});
  const [path, setPath] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<{ library: LibraryResponse; path: string } | null>(null);

  function refresh() {
    listLibraries()
      .then((list) => {
        setLibraries(list);
        // #252: every row shows its state straight away, no "Load status".
        for (const library of list) void handleStatus(library);
      })
      .catch((err: unknown) => setError(describeError(err)));
  }

  useEffect(refresh, []);

  // Light polling while any library is indexing; stops once none is.
  const indexingIds = libraries
    .filter((library) => waitingForIndex(statuses[library.id]))
    .map((library) => library.id)
    .join(",");
  useEffect(() => {
    if (!indexingIds) return;
    const timer = window.setInterval(() => {
      for (const id of indexingIds.split(",").map(Number)) {
        libraryStatus(id)
          .then((status) => setStatuses((prev) => ({ ...prev, [id]: status })))
          .catch(() => {});
      }
    }, INDEX_POLL_MS);
    return () => window.clearInterval(timer);
  }, [indexingIds]);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await addLibrary(path, displayName.trim() === "" ? undefined : displayName);
      setPath("");
      setDisplayName("");
      refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleRename(library: LibraryResponse) {
    const next = window.prompt("Display name", library.display_name);
    if (next === null || next.trim() === "") return;
    try {
      await renameLibrary(library.id, next);
      refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleRemove(library: LibraryResponse) {
    if (!window.confirm(`Remove "${library.display_name}" from this app? The files stay on disk.`)) return;
    try {
      await removeLibrary(library.id);
      refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleStatus(library: LibraryResponse) {
    try {
      const status = await libraryStatus(library.id);
      setStatuses((prev) => ({ ...prev, [library.id]: status }));
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleReindex(library: LibraryResponse) {
    try {
      const status = await reindexLibrary(library.id);
      setStatuses((prev) => ({ ...prev, [library.id]: status }));
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleReplaced(library: LibraryResponse) {
    setReplacing(null);
    refresh();
    await handleStatus(library);
  }

  return (
    <section>
      <h1>Libraries</h1>
      {error && <p role="alert">{error}</p>}
      {replacing && (
        <ReplaceDialog
          library={replacing.library}
          initialPath={replacing.path}
          onClose={() => setReplacing(null)}
          onReplaced={() => handleReplaced(replacing.library)}
        />
      )}

      <form onSubmit={handleAdd}>
        <label>
          Path
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/libraries/Family.photoslibrary" />
        </label>
        <label>
          Display name (optional)
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <button type="submit">Add library</button>
      </form>

      <div className="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Path</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {libraries.map((library) => {
              const status = statuses[library.id];
              return (
                <tr key={library.id}>
                  <td>{library.display_name}</td>
                  <td>{library.path}</td>
                  <td>
                    {status ? (
                      <ul>
                        <li>
                          <IndexState status={status} />
                        </li>
                        <li>{status.asset_count ?? "?"} assets</li>
                        <li>{status.video_count ?? "?"} videos</li>
                        <li>{status.last_indexed_at ?? "never indexed"}</li>
                        {status.last_update && <li>{status.last_update.summary}</li>}
                        <PrewarmControls key={`${library.id}-${status.prewarm?.state}`} libraryId={library.id} initial={status.prewarm} />
                        {status.updating && <li>Being updated: {status.updating_reason}</li>}
                        {status.suggestion && (
                          <li>
                            {status.suggestion.message}{" "}
                            <button
                              type="button"
                              onClick={() => setReplacing({ library, path: status.suggestion!.path })}
                            >
                              Replace with {status.suggestion.name}
                            </button>
                          </li>
                        )}
                        {status.suggestion && status.alternatives && status.alternatives.length > 0 && (
                          <li>
                            Other libraries next to it:
                            <ul aria-label="Other candidates">
                              {status.alternatives.map((candidate) => (
                                <li key={candidate.path}>
                                  {candidate.name}{" "}
                                  <button type="button" onClick={() => setReplacing({ library, path: candidate.path })}>
                                    Replace with {candidate.name}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </li>
                        )}
                        {status.warnings.map((warning) => (
                          <li key={warning.code} role="alert">
                            {warning.message}
                          </li>
                        ))}
                        {status.runs && status.runs.length > 0 && (
                          <li>
                            <details>
                              <summary>Update history ({Math.min(status.runs.length, 10)})</summary>
                              <ol aria-label="Update history">
                                {status.runs.slice(0, 10).map((run) => (
                                  <li key={run.id}>
                                    {run.started_at} · {run.trigger} · {run.outcome}: {run.summary}
                                    {run.error ? ` (${run.error})` : ""}
                                  </li>
                                ))}
                              </ol>
                            </details>
                          </li>
                        )}
                      </ul>
                    ) : (
                      <span role="status">Checking…</span>
                    )}
                  </td>
                  <td>
                    <button type="button" onClick={() => handleRename(library)}>
                      Rename
                    </button>
                    <button type="button" onClick={() => handleReindex(library)}>
                      Re-index
                    </button>
                    <button type="button" onClick={() => setReplacing({ library, path: "" })}>
                      Replace library file
                    </button>
                    <button type="button" onClick={() => handleRemove(library)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const INDEX_POLL_MS = 2000;

// A just-added library has no state until its background job starts.
function waitingForIndex(status: LibraryStatusResponse | undefined): boolean {
  if (!status) return false;
  return status.index_state === "indexing" || (!status.last_indexed_at && status.index_state !== "error");
}

// #252: "Indexing… N of M photos" with a bar, then "Ready — N photos", or the
// failure in plain words.
export function IndexState({ status }: { status: LibraryStatusResponse }) {
  if (status.index_state === "indexing") {
    const progress = status.index_progress;
    return (
      <span role="status" className="admin-index-state">
        {progress && progress.total > 0
          ? `Indexing… ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} photos`
          : "Indexing…"}
        <progress
          aria-label="Indexing progress"
          value={progress && progress.total > 0 ? progress.done : undefined}
          max={progress && progress.total > 0 ? progress.total : undefined}
        />
      </span>
    );
  }
  if (status.index_state === "error") {
    return (
      <span role="alert" className="admin-index-state">
        Indexing failed: {status.index_error ?? "unknown error"}. Check that the library is still there and press Re-index.
      </span>
    );
  }
  if (!status.last_indexed_at) return <span className="admin-index-state">Not indexed yet</span>;
  return (
    <span className="admin-index-state">
      Ready — {(status.asset_count ?? 0).toLocaleString()} photos
    </span>
  );
}

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "something went wrong";
}
