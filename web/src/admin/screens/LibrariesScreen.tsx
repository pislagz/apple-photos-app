import { useEffect, useState } from "react";
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

  function refresh() {
    listLibraries().then(setLibraries).catch((err: unknown) => setError(describeError(err)));
  }

  useEffect(refresh, []);

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

  return (
    <section>
      <h1>Libraries</h1>
      {error && <p role="alert">{error}</p>}

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
                      <li>{status.asset_count ?? "?"} assets</li>
                      <li>{status.video_count ?? "?"} videos</li>
                      <li>{status.last_indexed_at ?? "never indexed"}</li>
                      {status.warnings.map((warning) => (
                        <li key={warning.code} role="alert">
                          {warning.message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <button type="button" onClick={() => handleStatus(library)}>
                      Load status
                    </button>
                  )}
                </td>
                <td>
                  <button type="button" onClick={() => handleRename(library)}>
                    Rename
                  </button>
                  <button type="button" onClick={() => handleReindex(library)}>
                    Re-index
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

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "something went wrong";
}
